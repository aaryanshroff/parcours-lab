import json
from collections import defaultdict

from openai import OpenAI

from models import GraphResponse, SkillNode, Edge, Course, Position
from uwaterloo import get_course_prereqs, get_program

COL_GAP = 320   # horizontal gap between term columns
ROW_GAP = 200   # vertical gap between courses within a column
TERM_ORDER = ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"]
TERM_TO_TIER = {
    "1A": "foundation", "1B": "foundation",
    "2A": "core", "2B": "core",
    "3A": "advanced", "3B": "advanced",
    "4A": "specialization", "4B": "specialization",
}


def _normalize_code(code: str) -> str:
    """Remove spaces so 'CS 135' and 'CS135' match."""
    return code.replace(" ", "").upper()


def generate_academic_graph(
    requirement_groups: list[dict],
    specialization_pids: list[str],
    minor_pids: list[str],
    goal: str,
    api_key: str,
    model: str = "google/gemini-2.5-flash",
) -> GraphResponse:
    """Build a course DAG: deterministic for required courses, LLM for elective picks."""

    # ── 1. Merge requirement groups from major, specializations, and minors ──
    all_groups = list(requirement_groups)

    for pid in specialization_pids + minor_pids:
        prog = get_program(pid)
        if prog and prog.get("requirementGroups"):
            all_groups.extend(prog["requirementGroups"])

    # ── 2. Separate required vs choice groups, dedupe by code ──
    required_codes: set[str] = set()
    course_info: dict[str, dict] = {}  # normalized code -> {code, title, units}
    choice_groups: list[dict] = []

    for group in all_groups:
        rule = group.get("rule")
        courses = group.get("courses", [])

        if rule == "all":
            for c in courses:
                nc = _normalize_code(c["code"])
                required_codes.add(nc)
                course_info[nc] = c
        elif rule != "unknown":
            # numeric rule (pick N)
            choice_groups.append(group)
            for c in courses:
                course_info[_normalize_code(c["code"])] = c

    # ── 3. Fetch prereqs for required courses, build edges within the set ──
    prereq_map: dict[str, list[str]] = {}

    for code in required_codes:
        prereq_map[code] = _fetch_in_program_prereqs(code, required_codes)

    # ── 4. Pick electives via LLM (or default) ──
    elective_codes: set[str] = set()
    elective_reasons: dict[str, str] = {}

    if choice_groups:
        if goal.strip():
            picks = _pick_electives(choice_groups, goal, api_key, model)
        else:
            picks = _pick_defaults(choice_groups)

        for code, reason in picks.items():
            nc = _normalize_code(code)
            elective_codes.add(nc)
            elective_reasons[nc] = reason
            if nc not in course_info:
                course_info[nc] = {"code": code, "title": code, "units": 0.5}

    # Fetch prereqs for electives, linking back to required courses or other electives
    all_known = required_codes | elective_codes
    for code in elective_codes:
        prereq_map[code] = _fetch_in_program_prereqs(code, all_known)

    # ── 5. Assign terms via LLM ──
    all_codes = required_codes | elective_codes
    term_assignments = _assign_terms(
        all_codes, prereq_map, course_info, api_key, model
    )

    # ── 6. Layout: term-based columns (left-to-right) ──
    by_term: dict[str, list[str]] = defaultdict(list)
    for code in all_codes:
        term = term_assignments.get(code, "4B")
        by_term[term].append(code)

    # Sort within each term for deterministic output
    for t in by_term:
        by_term[t].sort()

    nodes: list[SkillNode] = []
    edges: list[Edge] = []

    for col, term in enumerate(TERM_ORDER):
        group = by_term.get(term, [])
        if not group:
            continue
        tier = TERM_TO_TIER.get(term, "core")

        for row, code in enumerate(group):
            info = course_info.get(code, {})
            node_id = code.lower()
            is_elective = code in elective_codes

            nodes.append(SkillNode(
                id=node_id,
                labels=[info.get("code", code)],
                tier=tier,
                term=term,
                course=Course(
                    title=info.get("title", code),
                    url=f"https://uwflow.com/course/{code.lower()}",
                    reason=elective_reasons.get(code, "Required course") if is_elective else "Required course",
                ),
                position=Position(x=col * COL_GAP, y=row * ROW_GAP),
            ))

            for prereq in prereq_map.get(code, []):
                prereq_id = prereq.lower()
                edges.append(Edge(
                    id=f"e-{prereq_id}-{node_id}",
                    source=prereq_id,
                    target=node_id,
                ))

    return GraphResponse(
        goal=goal or "Academic Plan",
        skills=sorted(all_codes),
        nodes=nodes,
        edges=edges,
    )


# ── Helpers ──────────────────────────────────────────────────────────────────


def _fetch_in_program_prereqs(code: str, known_codes: set[str]) -> list[str]:
    """Fetch prereqs for a course, returning only those in known_codes."""
    try:
        result = get_course_prereqs(code)
    except Exception:
        return []
    if not result or not result.get("prereqs"):
        return []
    return [
        _normalize_code(p)
        for p in result["prereqs"]
        if _normalize_code(p) in known_codes and _normalize_code(p) != code
    ]


def _compute_depths(codes: set[str], prereq_map: dict[str, list[str]]) -> dict[str, int]:
    """Longest path from a root (no in-program prereqs) to each course."""
    depth: dict[str, int] = {}

    def dfs(code: str, visiting: set[str]) -> int:
        if code in depth:
            return depth[code]
        if code in visiting:
            return 0  # cycle — break it
        visiting.add(code)
        prereqs = [p for p in prereq_map.get(code, []) if p in codes]
        depth[code] = (max(dfs(p, visiting) for p in prereqs) + 1) if prereqs else 0
        visiting.discard(code)
        return depth[code]

    for code in codes:
        if code not in depth:
            dfs(code, set())
    return depth


def _assign_terms(
    codes: set[str],
    prereq_map: dict[str, list[str]],
    course_info: dict[str, dict],
    api_key: str,
    model: str,
) -> dict[str, str]:
    """
    Use LLM to assign each course to a term (1A–4B).

    TODO: Scrape suggested course sequences from UWaterloo calendar pages
    (Kuali API `requiredCoursesTermByTerm` for Engineering programs,
    PDF sequences for CS programs at uwaterloo.ca/computer-science/suggested-sequences)
    and use those as the primary source. Fall back to LLM only for programs
    without a published sequence.
    """
    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)

    # Build a description of courses and their prereqs
    course_lines = []
    for code in sorted(codes):
        info = course_info.get(code, {})
        title = info.get("title", code)
        prereqs = prereq_map.get(code, [])
        prereq_str = ", ".join(prereqs) if prereqs else "none"
        course_lines.append(f"- {code} ({title}): prereqs [{prereq_str}]")

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a University of Waterloo academic advisor. "
                    "Assign each course to a term (1A, 1B, 2A, 2B, 3A, 3B, 4A, 4B) "
                    "for a co-op student following the standard study/work alternation.\n\n"
                    "Rules:\n"
                    "- A course MUST be in a later term than ALL of its prerequisites\n"
                    "- Balance roughly 5 courses per study term\n"
                    "- Follow typical UWaterloo course sequencing conventions\n"
                    "- MATH 1xx and CS 1xx courses go in 1A/1B\n"
                    "- Only assign to study terms: 1A, 1B, 2A, 2B, 3A, 3B, 4A, 4B\n\n"
                    "Return ONLY valid JSON, no other text. Schema:\n"
                    '{"assignments": {"COURSE_CODE": "TERM", ...}}'
                ),
            },
            {
                "role": "user",
                "content": "Assign these courses to terms:\n" + "\n".join(course_lines),
            },
        ],
        temperature=0.2,
    )

    raw = response.choices[0].message.content or "{}"
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    data = json.loads(raw)
    assignments = data.get("assignments", {})

    # Normalize codes in the response to match our internal codes
    return {
        _normalize_code(code): term
        for code, term in assignments.items()
        if term in TERM_ORDER
    }


def _pick_defaults(choice_groups: list[dict]) -> dict[str, str]:
    """No goal provided — just pick the first N from each group."""
    picks: dict[str, str] = {}
    for group in choice_groups:
        n = int(group["rule"])
        for c in group.get("courses", [])[:n]:
            picks[c["code"]] = "Default selection"
    return picks


def _pick_electives(
    choice_groups: list[dict],
    goal: str,
    api_key: str,
    model: str,
) -> dict[str, str]:
    """LLM picks N courses from each choice group based on the student's goal."""
    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)

    groups_desc = []
    for i, group in enumerate(choice_groups):
        n = int(group["rule"])
        options = [f"{c['code']} — {c.get('title', c['code'])}" for c in group.get("courses", [])]
        groups_desc.append(
            f"Group {i + 1} (pick {n}):\n" + "\n".join(f"  - {opt}" for opt in options)
        )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You help students pick elective courses based on their interests. "
                    "Given choice groups (each requiring you to pick N courses from the options), "
                    "select the courses that best align with the student's goal.\n\n"
                    "Return ONLY valid JSON, no other text. Schema:\n"
                    '{"picks": [{"code": "COURSE_CODE", "reason": "One sentence why"}]}'
                ),
            },
            {
                "role": "user",
                "content": f"Goal: {goal}\n\n" + "\n".join(groups_desc),
            },
        ],
        temperature=0.3,
    )

    raw = response.choices[0].message.content or "{}"
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    data = json.loads(raw)
    return {p["code"]: p.get("reason", "") for p in data.get("picks", [])}
