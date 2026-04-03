import json
import logging
from collections import defaultdict

from openai import OpenAI

from models import GraphResponse, SkillNode, Edge, Course, Position
import re
from uwaterloo import (
    get_course_prereqs,
    get_program,
    list_courses_by_subject,
    list_courses_excluding_subjects,
)

COL_GAP = 440   # horizontal gap between term columns
ROW_GAP = 220   # vertical gap between courses within a column
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

    logger = logging.getLogger("academic_graph")
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
            if not courses and group.get("elective_type"):
                expanded = _expand_elective_group(group)
                if expanded:
                    courses = expanded
                    group = {**group, "courses": expanded}
            if courses or group.get("elective_type"):
                choice_groups.append(group)
            for c in courses:
                course_info[_normalize_code(c["code"])] = c

    logger.info(
        "[academics] groups=%d required=%d choice_groups=%d",
        len(all_groups),
        len(required_codes),
        len(choice_groups),
    )

    # ── 3. Fetch prereqs for required courses, build edges within the set ──
    prereq_map: dict[str, list[str]] = {}

    for code in required_codes:
        prereq_map[code] = _fetch_in_program_prereqs(code, required_codes)

    # ── 4. Pick electives via LLM (or default) ──
    elective_codes: set[str] = set()
    elective_reasons: dict[str, str] = {}
    elective_group_options: dict[str, list[str]] = {}  # nc -> sibling codes in the same choice group

    picks: dict[str, str] = {}
    if choice_groups:
        if goal.strip():
            picks = _pick_electives(choice_groups, goal, api_key, model)
            picks = _fill_picks_with_defaults(choice_groups, picks)
        else:
            picks = _pick_defaults(choice_groups)

    # Build group-options map so each picked course knows its siblings
    for group in choice_groups:
        group_codes = [_normalize_code(c["code"]) for c in group.get("courses", [])]
        for nc in group_codes:
            if nc not in elective_group_options:
                elective_group_options[nc] = []
            # siblings = all others in the group
            elective_group_options[nc] = [c for c in group_codes if c != nc]

    for code, reason in picks.items():
        nc = _normalize_code(code)
        elective_codes.add(nc)
        elective_reasons[nc] = reason
        if nc not in course_info:
            course_info[nc] = {"code": code, "title": code, "units": 0.5}

    logger.info(
        "[academics] electives picked=%d (goal=%s)",
        len(elective_codes),
        "yes" if goal.strip() else "no",
    )

    # Fetch prereqs for electives, linking back to required courses or other electives
    all_known = required_codes | elective_codes
    for code in elective_codes:
        prereq_map[code] = _fetch_in_program_prereqs(code, all_known)

    prereq_map = _transitive_reduction(prereq_map)

    # ── 5. Assign terms via LLM, then enforce prereq ordering deterministically ──
    all_codes = required_codes | elective_codes
    term_assignments = _assign_terms(
        all_codes, prereq_map, course_info, api_key, model
    )
    term_assignments = _enforce_prereq_ordering(term_assignments, prereq_map, all_codes)

    # ── 6. Layout: term-based columns (left-to-right) ──
    by_term: dict[str, list[str]] = defaultdict(list)
    for code in all_codes:
        term = term_assignments.get(code, "4B")
        by_term[term].append(code)

    # ── Sugiyama median sort: align connected courses vertically ──
    # Build successor map (reverse of prereq_map)
    successor_map: dict[str, list[str]] = defaultdict(list)
    for code, prereqs in prereq_map.items():
        for prereq in prereqs:
            successor_map[prereq].append(code)

    active_terms = [t for t in TERM_ORDER if by_term.get(t)]
    placed_y: dict[str, float] = {}

    def _score_ltr(code: str) -> tuple[float, str]:
        prereqs = [p for p in prereq_map.get(code, []) if p in placed_y]
        y = sum(placed_y[p] for p in prereqs) / len(prereqs) if prereqs else float("inf")
        return (y, code)

    def _score_rtl(code: str) -> tuple[float, str]:
        succs = [s for s in successor_map.get(code, []) if s in placed_y]
        y = sum(placed_y[s] for s in succs) / len(succs) if succs else float("inf")
        return (y, code)

    def _place(term: str, key_fn) -> None:
        sorted_group = sorted(by_term[term], key=key_fn)
        by_term[term] = sorted_group
        for row, code in enumerate(sorted_group):
            placed_y[code] = row * ROW_GAP

    # Pass 1 – left to right
    for term in active_terms:
        _place(term, _score_ltr)

    # Pass 2 – right to left
    placed_y.clear()
    for term in reversed(active_terms):
        _place(term, _score_rtl)

    # Pass 3 – left to right (final)
    placed_y.clear()
    for term in active_terms:
        _place(term, _score_ltr)

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
                is_locked=not is_elective,
                is_required=True,  # every node in the graph is a required slot
                choice_options=elective_group_options.get(code, []) if is_elective else [],
                course=Course(
                    title=info.get("title", code),
                    url=f"https://uwflow.com/course/{code.lower()}",
                    reason=elective_reasons.get(code, "") if is_elective else "Required course",
                    units=float(info.get("units", 0.5)),
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


def _transitive_reduction(prereq_map: dict[str, list[str]]) -> dict[str, list[str]]:
    """Remove edge p→c if a longer path p→…→c already exists."""
    succ: dict[str, set[str]] = defaultdict(set)
    for code, prereqs in prereq_map.items():
        for p in prereqs:
            succ[p].add(code)

    reachable: dict[str, set[str]] = {}

    def _reach(node: str) -> set[str]:
        if node in reachable:
            return reachable[node]
        reachable[node] = set()
        result: set[str] = set()
        for s in succ.get(node, set()):
            result.add(s)
            result |= _reach(s)
        reachable[node] = result
        return result

    all_codes = set(prereq_map.keys()) | {p for ps in prereq_map.values() for p in ps}
    for code in all_codes:
        _reach(code)

    return {
        code: [
            p for p in prereqs
            if not any(q != p and q in reachable.get(p, set()) for q in prereqs)
        ]
        for code, prereqs in prereq_map.items()
    }


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
        try:
            raw_data = get_course_prereqs(code)
            raw_text = (raw_data.get("raw", "") if raw_data else "").strip()
        except Exception:
            raw_text = ""
        line = f"- {code} ({title}): in-plan prereqs [{prereq_str}]"
        if raw_text:
            line += f"; UW requirement: \"{raw_text}\""
        course_lines.append(line)

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
                    "- A course MUST be in a later term than ALL of its in-plan prerequisites\n"
                    "- If a course has a 'UW requirement' field, respect the prerequisite level "
                    "even if those prereqs are not in this plan (e.g. a course requiring a 200-level "
                    "course should not be placed in 1A/1B)\n"
                    "- Keep total credits per term at or below 3.25 (most courses are 0.5 credits; check the units field if provided)\n"
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


def _enforce_prereq_ordering(
    term_assignments: dict[str, str],
    prereq_map: dict[str, list[str]],
    all_codes: set[str],
) -> dict[str, str]:
    """Bump courses to later terms until no prereq-ordering violations remain.

    Two rules:
    - In-plan prereq: course must be in a strictly later term than its prereq.
    - External prereq (not in plan): floor the course's term using the catalog
      number of the highest-level external prereq (100s→1B, 200s→2A, 300s→3A, 400s→4A).
    """
    LEVEL_TO_MIN_IDX = {
        1: TERM_ORDER.index("1B"),
        2: TERM_ORDER.index("2A"),
        3: TERM_ORDER.index("3A"),
        4: TERM_ORDER.index("4A"),
    }

    def _external_min_idx(code: str) -> int:
        try:
            prereq_data = get_course_prereqs(code)
        except Exception:
            return 0
        if not prereq_data:
            return 0
        max_level = 0
        for p in prereq_data.get("prereqs", []):
            if _normalize_code(p) in all_codes:
                continue  # in-plan; handled by prereq_map
            m = re.search(r"(\d{3})", p)
            if m:
                max_level = max(max_level, int(m.group(1)) // 100)
        return LEVEL_TO_MIN_IDX.get(min(max_level, 4), 0)

    result = dict(term_assignments)

    for _ in range(len(TERM_ORDER)):
        changed = False
        for code in list(result.keys()):
            current = result.get(code, "4B")
            current_idx = TERM_ORDER.index(current) if current in TERM_ORDER else len(TERM_ORDER) - 1
            min_idx = _external_min_idx(code)

            for prereq in prereq_map.get(code, []):
                prereq_term = result.get(prereq)
                if prereq_term in TERM_ORDER:
                    min_idx = max(min_idx, TERM_ORDER.index(prereq_term) + 1)

            if current_idx < min_idx:
                result[code] = TERM_ORDER[min(min_idx, len(TERM_ORDER) - 1)]
                changed = True
        if not changed:
            break

    return result


def _pick_defaults(choice_groups: list[dict]) -> dict[str, str]:
    """No goal provided — just pick the first N from each group."""
    picks: dict[str, str] = {}
    for group in choice_groups:
        if not group.get("courses"):
            expanded = _expand_elective_group(group)
            if expanded:
                group["courses"] = expanded
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
        expanded = _expand_elective_group(group)
        if expanded:
            group["courses"] = expanded
        trimmed = _downselect_elective_options(group.get("courses", []), goal)
        options = [f"{c['code']} — {c.get('title', c['code'])}" for c in trimmed]
        if not options:
            continue
        header = f"Group {i + 1} (pick {n})"
        if group.get("description"):
            header += f": {group['description']}"
        groups_desc.append(header + "\n" + "\n".join(f"  - {opt}" for opt in options))

    if not groups_desc:
        return {}

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


def _fill_picks_with_defaults(
    choice_groups: list[dict],
    picks: dict[str, str],
) -> dict[str, str]:
    """Ensure each choice group contributes N picks; fill gaps with defaults."""
    if not choice_groups:
        return picks

    normalized = {_normalize_code(code): code for code in picks.keys()}
    filled = dict(picks)

    for group in choice_groups:
        n = int(group.get("rule", 0))
        if n <= 0:
            continue

        options = group.get("courses", [])
        if not options and group.get("elective_type"):
            expanded = _expand_elective_group(group)
            if expanded:
                options = expanded

        if not options:
            continue

        group_codes = [_normalize_code(c["code"]) for c in options]
        picked_in_group = [code for code in group_codes if code in normalized]
        needed = n - len(picked_in_group)
        if needed <= 0:
            continue

        for c in options:
            code = c["code"]
            ncode = _normalize_code(code)
            if ncode in normalized:
                continue
            filled[code] = "Default selection"
            normalized[ncode] = code
            needed -= 1
            if needed == 0:
                break

    return filled


def _expand_elective_group(group: dict) -> list[dict]:
    """Expand elective groups with no explicit courses using UW API (range-based electives)."""
    if group.get("courses"):
        return group["courses"]

    elective_type = group.get("elective_type")
    if elective_type == "breadth":
        exclude = {
            "CS", "MATH", "STAT", "CO", "AMATH", "PMATH", "ACTSC",
        }
        # Prefer common humanities/social-science subjects; sort by catalog number so
        # lower-level (more accessible) courses appear first.
        preferred_subjects = {"ENGL", "ECON", "PSYCH", "SOC", "PHIL", "COMMST", "SCI", "ARTS", "HRM", "MUSIC", "FINE"}
        courses = list_courses_excluding_subjects(exclude)
        preferred = sorted(
            [c for c in courses if c.get("code", "").split()[0].upper() in preferred_subjects],
            key=lambda c: _catalog_number(c.get("code", "")) or 9999,
        )
        other = [c for c in courses if c.get("code", "").split()[0].upper() not in preferred_subjects]
        return preferred + other

    if elective_type != "range":
        return []

    subject = group.get("subject", "").upper().strip()
    ranges = group.get("ranges") or []
    if (not subject or not ranges) and group.get("description"):
        parsed_ranges = _extract_ranges_from_text(group["description"])
        if parsed_ranges:
            ranges = ranges or parsed_ranges
            if not subject:
                subject = parsed_ranges[0]["subject"]
    if not subject and ranges:
        subject = str(ranges[0].get("subject", "")).upper().strip()
    if not subject:
        return []

    courses = list_courses_by_subject(subject)
    if not courses:
        return []

    if ranges:
        filtered = []
        for c in courses:
            num = _catalog_number(c.get("code", ""))
            if num is None:
                continue
            for r in ranges:
                start = _catalog_number(r.get("catalog_start")) if r.get("catalog_start") else None
                end = _catalog_number(r.get("catalog_end")) if r.get("catalog_end") else None
                if start is not None and num < start:
                    continue
                if end is not None and num > end:
                    continue
                filtered.append(c)
                break
        return filtered

    start = group.get("catalog_start")
    end = group.get("catalog_end")
    if not start and not end:
        return courses

    start_num = _catalog_number(start) if start else None
    end_num = _catalog_number(end) if end else None

    if start_num is None and end_num is None:
        return courses

    filtered = []
    for c in courses:
        num = _catalog_number(c.get("code", ""))
        if num is None:
            continue
        if start_num is not None and num < start_num:
            continue
        if end_num is not None and num > end_num:
            continue
        filtered.append(c)
    return filtered


def _catalog_number(code: str) -> int | None:
    m = re.search(r"(\d{3})", str(code))
    if not m:
        return None
    try:
        return int(m.group(1))
    except ValueError:
        return None


def _extract_ranges_from_text(text: str) -> list[dict]:
    ranges = []
    for m in re.finditer(r"([A-Z]{2,})\s*(\d{3}[A-Z]?)\s*-\s*([A-Z]{2,})?\s*(\d{3}[A-Z]?)", text):
        subj = (m.group(1) or "").upper()
        end_subj = (m.group(3) or "").upper()
        if end_subj and end_subj != subj:
            continue
        ranges.append({
            "subject": subj,
            "catalog_start": m.group(2),
            "catalog_end": m.group(4),
        })
    return ranges


def _downselect_elective_options(courses: list[dict], goal: str, limit: int = 80) -> list[dict]:
    if len(courses) <= limit:
        return courses

    tokens = set(re.findall(r"[a-zA-Z]{3,}", goal.lower()))
    if not tokens:
        return courses[:limit]

    scored: list[tuple[int, int, dict]] = []
    for idx, c in enumerate(courses):
        title = str(c.get("title", "")).lower()
        score = sum(1 for t in tokens if t in title)
        scored.append((score, idx, c))

    scored.sort(key=lambda x: (x[0], -x[1]), reverse=True)
    top = [c for score, _, c in scored if score > 0]
    if len(top) >= limit:
        return top[:limit]

    remaining = [c for score, _, c in scored if score <= 0]
    return (top + remaining)[:limit]
