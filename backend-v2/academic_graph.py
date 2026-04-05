import json
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

from openai import OpenAI

from models import GraphResponse, SkillNode, Edge, Course, CourseRating, Position
import re
from uwaterloo import (
    get_course_prereqs,
    get_program,
    list_courses_by_subject,
    list_courses_excluding_subjects,
    get_uwflow_ratings_bulk,
    format_uwflow_rating,
    search_courses_by_title,
)

logger = logging.getLogger("academic_graph")
logger.addHandler(logging.StreamHandler())
logger.setLevel(logging.INFO)

COL_GAP = 440   # horizontal gap between term columns
ROW_GAP = 220   # vertical gap between courses within a column
TERM_ORDER = ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"]

# Maps lowercase substrings of a program title to its primary subject code(s).
# Used to derive enrollment-restriction subjects from the major title sent by the frontend.
_PROGRAM_SUBJECTS: dict[str, set[str]] = {
    "computer science": {"CS"},
    "software engineering": {"SE"},
    "electrical engineering": {"ECE"},
    "computer engineering": {"ECE"},
    "mechanical engineering": {"ME"},
    "civil engineering": {"CE"},
    "systems design engineering": {"SYDE"},
    "mathematics": {"MATH"},
    "applied mathematics": {"AMATH"},
    "pure mathematics": {"PMATH"},
    "statistics": {"STAT"},
    "actuarial science": {"ACTSC"},
    "combinatorics and optimization": {"CO"},
    "data science": {"CS", "STAT"},
    "accounting": {"AFM"},
    "finance": {"FARM"},
    "economics": {"ECON"},
    "management engineering": {"MSCI"},
}


def _program_subjects_from_title(major_title: str) -> set[str]:
    """Return the primary subject code(s) for a program title."""
    lower = major_title.lower()
    subjects: set[str] = set()
    # Longest match first so "combinatorics and optimization" beats "mathematics"
    for key in sorted(_PROGRAM_SUBJECTS, key=len, reverse=True):
        if key in lower:
            subjects |= _PROGRAM_SUBJECTS[key]
            break   # one match is enough; the title names one program
    return subjects


def _is_accessible(code: str, program_subjects: set[str]) -> bool:
    """Return False if the UW enrollment restriction excludes this program.

    Uses only the local prereq cache to avoid hammering the UW API.
    If a course isn't cached, assume it's accessible.
    """
    if not program_subjects:
        return True
    from uwaterloo import _load_course_cache
    data = _load_course_cache().get(code)
    if not data:
        return True
    raw = (data.get("raw", "") or "").lower()
    if not raw:
        return True

    def _subjects_in(phrase: str) -> set[str]:
        found: set[str] = set()
        for name, subjs in _PROGRAM_SUBJECTS.items():
            if name in phrase:
                found |= subjs
        # also catch bare codes like "CS", "MATH" that appear directly in the text
        for m in re.finditer(r"\b([A-Z]{2,6})\b", phrase.upper()):
            found.add(m.group(1))
        return found

    # DENY: "not open to X students" / "not open to students in X programs"
    for m in re.finditer(r"not open to (?:students in )?([^.;\n]+?)\s*(?:students?|programs?)", raw):
        if _subjects_in(m.group(1)) & program_subjects:
            return False

    # ALLOW-only: "X students only" / "for X students only" / "restricted to X students"
    for pattern in [
        r"(?:for\s+)?([^.;\n]+?)\s*students? only",
        r"restricted to ([^.;\n]+?)\s*students?",
        r"open to ([^.;\n]+?)\s*students? only",
    ]:
        for m in re.finditer(pattern, raw):
            allowed = _subjects_in(m.group(1))
            if allowed and not (allowed & program_subjects):
                return False

    return True
TERM_TO_TIER = {
    "1A": "foundation", "1B": "foundation",
    "2A": "core", "2B": "core",
    "3A": "advanced", "3B": "advanced",
    "4A": "specialization", "4B": "specialization",
}


def _normalize_code(code: str) -> str:
    """Remove spaces so 'CS 135' and 'CS135' match."""
    return code.replace(" ", "").upper()


def _get_antireqs(code: str) -> set[str]:
    """Return normalized anti-requisite codes for a course from the cache."""
    from uwaterloo import _load_course_cache
    data = _load_course_cache().get(code)
    if not data:
        return set()
    return {_normalize_code(a) for a in data.get("antireqs", [])}


def generate_academic_graph(
    requirement_groups: list[dict],
    specialization_pids: list[str],
    minor_pids: list[str],
    goal: str,
    api_key: str,
    model: str = "openai/gpt-4.1-mini",
    elective_model: str = "openai/gpt-4.1-mini",
    major_title: str = "",
    desired_skills: list[str] | None = None,
    my_skills: list[str] | None = None,
) -> GraphResponse:
    """Build a course DAG: deterministic for required courses, LLM for elective picks."""
    import time as _time
    _t0 = _time.perf_counter()
    def _lap(label: str) -> None:
        logger.info("[academics][timing] %s — %.2fs elapsed", label, _time.perf_counter() - _t0)

    # ── 1. Merge requirement groups from major, specializations, and minors ──
    all_groups = list(requirement_groups)

    for pid in specialization_pids + minor_pids:
        prog = get_program(pid)
        if prog and prog.get("requirementGroups"):
            all_groups.extend(prog["requirementGroups"])

    _lap("1. merge groups")

    # ── 2. Separate required vs choice groups, dedupe by code ──
    required_codes: set[str] = set()
    required_order: list[str] = []  # insertion order for antireq dedup
    course_info: dict[str, dict] = {}  # normalized code -> {code, title, units}
    choice_groups: list[dict] = []
    seen_choice_groups: set[tuple] = set()
    true_elective_pool: set[str] = set()

    for group in all_groups:
        rule = group.get("rule")
        courses = group.get("courses", [])

        if rule == "all":
            for c in courses:
                nc = _normalize_code(c["code"])
                if nc not in required_codes:
                    required_order.append(nc)
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
                # Deduplicate: skip if an identical group (same rule + same course codes) already exists
                group_key = (
                    str(rule),
                    frozenset(_normalize_code(c["code"]) for c in courses),
                )
                if group_key not in seen_choice_groups:
                    seen_choice_groups.add(group_key)
                    choice_groups.append(group)
            is_true_elective = bool(group.get("elective_type"))
            for c in courses:
                nc = _normalize_code(c["code"])
                course_info[nc] = c
                if is_true_elective:
                    true_elective_pool.add(nc)

    # ── 2b. Remove anti-requisite conflicts among required courses ──
    # First-added wins (major groups come before specialization/minor groups)
    blocked: set[str] = set()
    kept_required: set[str] = set()
    for code in required_order:
        if code in blocked:
            logger.info("[academics] dropping required %s (antireq of another required course)", code)
            continue
        kept_required.add(code)
        blocked |= _get_antireqs(code)
    required_codes = kept_required

    logger.info(
        "[academics] groups=%d required=%d choice_groups=%d",
        len(all_groups),
        len(required_codes),
        len(choice_groups),
    )

    # ── 2c. Filter choice groups: remove antireqs of required courses ──
    required_antireqs: set[str] = set()
    for code in required_codes:
        required_antireqs |= _get_antireqs(code)
    for group in choice_groups:
        if group.get("courses"):
            group["courses"] = [
                c for c in group["courses"]
                if _normalize_code(c["code"]) not in required_antireqs
                and _normalize_code(c["code"]) not in required_codes
            ]

    _lap("2. separate/dedupe/antireqs")

    # ── 3. Fetch prereqs for required courses, build edges within the set ──
    prereq_map: dict[str, list[str]] = {}

    with ThreadPoolExecutor(max_workers=min(12, len(required_codes) or 1)) as pool:
        fut_to_code = {
            pool.submit(_fetch_in_program_prereqs, code, required_codes): code
            for code in required_codes
        }
        for fut in as_completed(fut_to_code):
            prereq_map[fut_to_code[fut]] = fut.result()

    _lap("3. fetch prereqs (required, parallel)")

    # ── 4. Pick electives via LLM (or default) ──
    program_subjects = _program_subjects_from_title(major_title)

    elective_codes: set[str] = set()
    elective_reasons: dict[str, str] = {}

    if choice_groups:
        _filter_variant_preferences(choice_groups, major_title)
        if goal.strip():
            picks = _pick_electives(choice_groups, goal, api_key, elective_model, program_subjects, major_title, desired_skills=desired_skills, my_skills=my_skills)
            picks = _fill_picks_with_defaults(choice_groups, picks)
        else:
            picks = _pick_defaults(choice_groups, program_subjects)
    for code, reason in picks.items():
        nc = _normalize_code(code)
        elective_codes.add(nc)
        elective_reasons[nc] = reason
        if nc not in course_info:
            course_info[nc] = {"code": code, "title": code, "units": 0.5}

    # ── 4b. Drop electives that conflict with required or other elective antireqs ──
    blocked_codes = set(required_antireqs) | required_codes
    safe_elective_codes: set[str] = set()
    for code in sorted(elective_codes):
        if code in blocked_codes:
            logger.info("[academics] dropping elective %s (antireq conflict)", code)
            continue
        safe_elective_codes.add(code)
        blocked_codes |= _get_antireqs(code)
    elective_codes = safe_elective_codes
    elective_reasons = {k: v for k, v in elective_reasons.items() if k in elective_codes}

    true_elective_codes = {nc for nc in elective_codes if nc in true_elective_pool}

    logger.info(
        "[academics] electives picked=%d (true_elective=%d, required_choice=%d, goal=%s)",
        len(elective_codes),
        len(true_elective_codes),
        len(elective_codes) - len(true_elective_codes),
        "yes" if goal.strip() else "no",
    )

    _lap("4. pick electives (LLM: %s)" % elective_model)

    # Fetch prereqs for electives, linking back to required courses or other electives
    all_known = required_codes | elective_codes
    if elective_codes:
        with ThreadPoolExecutor(max_workers=min(12, len(elective_codes))) as pool:
            fut_to_code = {
                pool.submit(_fetch_in_program_prereqs, code, all_known): code
                for code in elective_codes
            }
            for fut in as_completed(fut_to_code):
                prereq_map[fut_to_code[fut]] = fut.result()

    _lap("4b. fetch prereqs (electives, parallel)")

    prereq_map = _transitive_reduction(prereq_map)

    # ── 5. Assign terms, map ESCO skills, and fetch UWFlow ratings concurrently ──
    all_codes = required_codes | elective_codes

    with ThreadPoolExecutor(max_workers=3) as pool:
        term_future = pool.submit(
            _assign_terms, all_codes, prereq_map, course_info, api_key, model,
        )
        esco_future = pool.submit(
            _map_courses_to_esco_skills, all_codes, course_info, goal, api_key, model, desired_skills, my_skills,
        )
        ratings_future = pool.submit(get_uwflow_ratings_bulk, list(all_codes))

        term_assignments = term_future.result()
        esco_map = esco_future.result()
        all_ratings = ratings_future.result()

    _lap("5. assign_terms + esco + ratings (parallel)")

    # Enforce prereq ordering deterministically (fast, CPU-only)
    term_assignments = _enforce_prereq_ordering(term_assignments, prereq_map, all_codes)
    term_assignments = _enforce_credit_cap(term_assignments, course_info, prereq_map=prereq_map)
    term_assignments = _enforce_prereq_ordering(term_assignments, prereq_map, all_codes)
    term_assignments = _balance_terms(term_assignments, prereq_map, course_info)

    _lap("5b. enforce ordering + credit cap + balance")

    # ── 6. Layout: term-based columns (left-to-right) ──
    by_term: dict[str, list[str]] = defaultdict(list)
    for code in all_codes:
        term = term_assignments.get(code, "4B")
        by_term[term].append(code)

    # ── Sugiyama median sort: align connected courses vertically ──
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
            is_true_elective = code in true_elective_codes

            uwflow = all_ratings.get(code)
            course_rating = None
            if uwflow:
                course_rating = CourseRating(
                    liked=uwflow.get("liked"),
                    easy=uwflow.get("easy"),
                    useful=uwflow.get("useful"),
                    filled_count=uwflow.get("filled_count"),
                )

            nodes.append(SkillNode(
                id=node_id,
                labels=[info.get("code", code)],
                tier=tier,
                term=term,
                course=Course(
                    title=info.get("title", code),
                    url=f"https://uwflow.com/course/{code.lower()}",
                    reason=elective_reasons.get(code, "Required course") if is_true_elective else "Required course",
                    units=float(info.get("units", 0.5)),
                    rating=course_rating,
                ),
                position=Position(x=col * COL_GAP, y=row * ROW_GAP),
                esco_skills=esco_map.get(code, []),
                required=not is_true_elective,
            ))

            for prereq in prereq_map.get(code, []):
                prereq_id = prereq.lower()
                edges.append(Edge(
                    id=f"e-{prereq_id}-{node_id}",
                    source=prereq_id,
                    target=node_id,
                ))

    _lap("6. layout + build nodes")

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
    except Exception as e:
        logger.warning("_fetch_in_program_prereqs(%s) failed: %s", code, e)
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
        except Exception as e:
            logger.warning("_assign_terms: get_course_prereqs(%s) failed: %s", code, e)
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
                    "- HARD LIMIT: Total credits per term MUST NOT exceed 2.5. "
                    "Most courses are 0.5 credits each (so 5 courses per term max). Before finalizing each term, explicitly sum "
                    "the credits of every course assigned to it. If the sum exceeds 2.5, move the "
                    "excess course(s) to the next term. Double-check your arithmetic.\n"
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
        except Exception as e:
            logger.warning("_external_min_idx(%s) failed: %s", code, e)
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


def _enforce_credit_cap(
    term_assignments: dict[str, str],
    course_info: dict[str, dict],
    max_credits: float = 2.5,
    prereq_map: dict[str, list[str]] | None = None,
) -> dict[str, str]:
    """Bump courses to later terms until no term exceeds max_credits.

    Bumps the highest course-number first, since advanced courses are most
    likely to fit naturally in a later term.  When bumping, searches forward
    for the earliest term that has room *and* satisfies prerequisite ordering,
    avoiding the cascade where every overflow piles into the next term.
    """
    result = dict(term_assignments)
    prereq_map = prereq_map or {}

    def _term_credits(term: str) -> float:
        return sum(
            float(course_info.get(c, {}).get("units", 0.5))
            for c, t in result.items() if t == term
        )

    def _min_term_idx_for(code: str) -> int:
        """Earliest term index this course can occupy (after all its prereqs)."""
        min_idx = 0
        for prereq in prereq_map.get(code, []):
            prereq_term = result.get(prereq)
            if prereq_term in TERM_ORDER:
                min_idx = max(min_idx, TERM_ORDER.index(prereq_term) + 1)
        return min_idx

    for _ in range(len(TERM_ORDER)):
        changed = False
        for term in TERM_ORDER:
            courses_in_term = [c for c, t in result.items() if t == term]
            total = sum(float(course_info.get(c, {}).get("units", 0.5)) for c in courses_in_term)
            if total <= max_credits:
                continue
            courses_in_term.sort(
                key=lambda c: int(m.group()) if (m := re.search(r"\d+", c)) else 0,
                reverse=True,
            )
            term_idx = TERM_ORDER.index(term)
            if term_idx + 1 >= len(TERM_ORDER):
                continue
            for c in courses_in_term:
                credits = float(course_info.get(c, {}).get("units", 0.5))
                floor_idx = max(term_idx + 1, _min_term_idx_for(c))
                dest_idx = None
                for candidate_idx in range(floor_idx, len(TERM_ORDER)):
                    if _term_credits(TERM_ORDER[candidate_idx]) + credits <= max_credits:
                        dest_idx = candidate_idx
                        break
                if dest_idx is None:
                    dest_idx = min(term_idx + 1, len(TERM_ORDER) - 1)
                result[c] = TERM_ORDER[dest_idx]
                total -= credits
                changed = True
                if total <= max_credits:
                    break
        if not changed:
            break

    return result


def _balance_terms(
    term_assignments: dict[str, str],
    prereq_map: dict[str, list[str]],
    course_info: dict[str, dict],
    max_credits: float = 2.5,
) -> dict[str, str]:
    """Pull courses backward from heavy later terms into lighter earlier terms.

    Iterates from the latest term backward.  For each course, finds the
    lightest earlier term that can accept it without violating prerequisites,
    successor ordering, or the credit cap.
    """
    result = dict(term_assignments)

    successor_map: dict[str, list[str]] = defaultdict(list)
    for code, prereqs in prereq_map.items():
        for p in prereqs:
            successor_map[p].append(code)

    def _term_credits(term: str) -> float:
        return sum(
            float(course_info.get(c, {}).get("units", 0.5))
            for c, t in result.items() if t == term
        )

    changed = True
    iterations = 0
    while changed and iterations < len(TERM_ORDER) * 2:
        changed = False
        iterations += 1
        for term_idx in range(len(TERM_ORDER) - 1, 0, -1):
            term = TERM_ORDER[term_idx]
            courses_in_term = [c for c, t in result.items() if t == term]
            if not courses_in_term:
                continue

            for course in courses_in_term:
                floor_idx = 0
                for prereq in prereq_map.get(course, []):
                    prereq_term = result.get(prereq)
                    if prereq_term in TERM_ORDER:
                        floor_idx = max(floor_idx, TERM_ORDER.index(prereq_term) + 1)

                ceiling_idx = len(TERM_ORDER) - 1
                for succ in successor_map.get(course, []):
                    succ_term = result.get(succ)
                    if succ_term in TERM_ORDER:
                        ceiling_idx = min(ceiling_idx, TERM_ORDER.index(succ_term) - 1)

                if floor_idx >= term_idx:
                    continue

                course_credits = float(course_info.get(course, {}).get("units", 0.5))
                best_idx = None
                best_credits = float("inf")
                for candidate_idx in range(floor_idx, min(term_idx, ceiling_idx + 1)):
                    cand_term = TERM_ORDER[candidate_idx]
                    cand_credits = _term_credits(cand_term)
                    if cand_credits + course_credits <= max_credits and cand_credits < best_credits:
                        best_credits = cand_credits
                        best_idx = candidate_idx

                if best_idx is not None:
                    result[course] = TERM_ORDER[best_idx]
                    changed = True

    return result


def _map_courses_to_esco_skills(
    codes: set[str],
    course_info: dict[str, dict],
    goal: str,
    api_key: str,
    model: str,
    desired_skills: list[str] | None = None,
    my_skills: list[str] | None = None,
) -> dict[str, list[str]]:
    """Use LLM to assign 1-3 ESCO skill labels to each course."""
    if not codes:
        return {}

    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)

    course_lines = []
    for code in sorted(codes):
        info = course_info.get(code, {})
        title = info.get("title", code)
        course_lines.append(f"- {code}: {title}")

    skills_context = ""
    if desired_skills:
        skills_context += f"\nDesired skills: {', '.join(desired_skills)}"
    if my_skills:
        skills_context += f"\nExisting skills: {', '.join(my_skills)}"

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You map university courses to ESCO (European Skills, Competences, Qualifications and Occupations) skill labels. "
                    "For each course, assign 1-3 concise ESCO-style skill labels that the course teaches. "
                    "Use standard ESCO skill terminology (e.g. 'Python programming', 'data analysis', "
                    "'algorithm design', 'linear algebra', 'technical writing'). Keep labels short (1-4 words).\n\n"
                    "If the student has desired skills, prefer mapping courses to those skill labels where applicable. "
                    "Do NOT invent skills unrelated to the course content.\n\n"
                    "Return ONLY valid JSON, no other text. Schema:\n"
                    '{"mappings": {"COURSE_CODE": ["skill1", "skill2"]}}'
                ),
            },
            {
                "role": "user",
                "content": (
                    (f"Goal: {goal}\n" if goal else "")
                    + skills_context
                    + "\n\nCourses:\n" + "\n".join(course_lines)
                ),
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

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("[academics] failed to parse ESCO mapping response: %s", raw[:200])
        return {}

    result: dict[str, list[str]] = {}
    for code, skills in data.get("mappings", {}).items():
        nc = _normalize_code(code)
        if nc in codes and isinstance(skills, list):
            result[nc] = [s for s in skills[:3] if isinstance(s, str)]

    logger.info("[academics] ESCO mapped %d/%d courses", len(result), len(codes))
    return result


# Course codes where "for the Sciences" variants should be removed for Faculty of Math students.
# Maps the non-honours code to its honours replacement so we only remove when the replacement exists.
_MATH_FACULTY_VARIANT_MAP: dict[str, str] = {
    "MATH127": "MATH137",  # Calculus 1 for Sciences → Honours
    "MATH128": "MATH138",  # Calculus 2 for Sciences → Honours
    "MATH227": "MATH237",  # Calc 3 for Sciences → Honours (if applicable)
    "MATH228": "MATH238",
    "CS115":   "CS135",    # Intro CS 1 for non-majors → Designing Functional Programs
    "CS116":   "CS136",    # Intro CS 2 for Sciences → CS for Math
}


def _filter_variant_preferences(choice_groups: list[dict], major_title: str) -> None:
    """Remove non-honours course variants from choice groups when the student's program
    implies they should take the honours version. Mutates groups in place."""
    lower = major_title.lower()
    is_math_faculty = "math" in lower or "computer science" in lower or "statistics" in lower

    if not is_math_faculty:
        return

    for group in choice_groups:
        courses = group.get("courses")
        if not courses:
            continue
        codes_in_group = {_normalize_code(c["code"]) for c in courses}
        group["courses"] = [
            c for c in courses
            if _normalize_code(c["code"]) not in _MATH_FACULTY_VARIANT_MAP
            or _MATH_FACULTY_VARIANT_MAP[_normalize_code(c["code"])] not in codes_in_group
        ]


def add_course_for_skill(
    skill: str,
    existing_codes: list[str],
    term_assignments: dict[str, str],
    goal: str,
    major_title: str,
    api_key: str,
    model: str = "openai/gpt-4.1-mini",
) -> dict:
    """Find one UW course that teaches the given ESCO skill and assign it to an appropriate term.

    Returns {"node": SkillNode, "edge_sources": [prereq_ids]} or {"error": "..."}.
    """
    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
    existing_set = {_normalize_code(c) for c in existing_codes}
    program_subjects = _program_subjects_from_title(major_title)

    # Gather anti-reqs of existing courses so we don't suggest conflicts
    blocked: set[str] = set(existing_set)
    for code in existing_set:
        blocked |= _get_antireqs(code)

    # Infer candidate subjects from the skill + program
    resp_subj = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": (
                "Given a skill and a university program, return the 2-4 UWaterloo subject codes "
                "(e.g. CS, MATH, STAT, PSYCH, ECON) most likely to offer courses teaching that skill. "
                "Return ONLY a JSON array of uppercase subject codes, no other text."
            )},
            {"role": "user", "content": f"Skill: {skill}\nProgram: {major_title}"},
        ],
        temperature=0.1,
    )
    raw_subj = resp_subj.choices[0].message.content or "[]"
    raw_subj = raw_subj.strip()
    if raw_subj.startswith("```"):
        raw_subj = raw_subj.split("\n", 1)[1] if "\n" in raw_subj else raw_subj[3:]
        if raw_subj.endswith("```"):
            raw_subj = raw_subj[:-3]
        raw_subj = raw_subj.strip()
    try:
        subjects = json.loads(raw_subj)
    except json.JSONDecodeError:
        subjects = []

    # Collect candidate courses from those subjects
    candidates: list[dict] = []
    for subj in subjects[:4]:
        for c in list_courses_by_subject(subj):
            nc = _normalize_code(c["code"])
            if nc not in blocked and _is_accessible(c["code"], program_subjects):
                candidates.append(c)

    if not candidates:
        return {"error": f"No available courses found for \"{skill}\""}

    # Fetch ratings for candidates
    uwflow_ratings = get_uwflow_ratings_bulk([c["code"] for c in candidates[:50]])

    course_lines = []
    for c in candidates[:50]:
        line = f"- {c['code']}: {c['title']}"
        rating_str = format_uwflow_rating(uwflow_ratings.get(c['code'].replace(' ', '').upper()))
        if rating_str:
            line += f" {rating_str}"
        course_lines.append(line)

    resp_pick = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": (
                "Pick ONE course from the list that best teaches the given ESCO skill for this student. "
                "The course must genuinely teach this skill, not just be tangentially related. "
                "Prefer well-rated courses. Return ONLY valid JSON: "
                '{"code": "<COURSE CODE>", "title": "<title>", "reason": "<one sentence>"}'
            )},
            {"role": "user", "content": (
                f"Skill to learn: {skill}\n"
                f"Program: {major_title}\n"
                + (f"Goal: {goal}\n" if goal else "")
                + "\nCourses:\n" + "\n".join(course_lines)
            )},
        ],
        temperature=0.2,
    )
    raw_pick = resp_pick.choices[0].message.content or "{}"
    raw_pick = raw_pick.strip()
    if raw_pick.startswith("```"):
        raw_pick = raw_pick.split("\n", 1)[1] if "\n" in raw_pick else raw_pick[3:]
        if raw_pick.endswith("```"):
            raw_pick = raw_pick[:-3]
        raw_pick = raw_pick.strip()

    try:
        picked = json.loads(raw_pick)
    except json.JSONDecodeError:
        return {"error": f"Failed to pick a course for \"{skill}\""}

    code = picked.get("code", "")
    nc = _normalize_code(code)
    if not nc:
        return {"error": f"Failed to pick a course for \"{skill}\""}

    title = picked.get("title", code)
    reason = picked.get("reason", "")

    # Determine term: must be after all in-plan prereqs
    prereqs = _fetch_in_program_prereqs(nc, existing_set | {nc})
    min_term_idx = 0
    for p in prereqs:
        p_term = term_assignments.get(p)
        if p_term in TERM_ORDER:
            min_term_idx = max(min_term_idx, TERM_ORDER.index(p_term) + 1)

    # Also respect external prereq levels
    try:
        prereq_data = get_course_prereqs(nc)
    except Exception:
        prereq_data = None
    if prereq_data:
        for p in prereq_data.get("prereqs", []):
            if _normalize_code(p) in existing_set:
                continue
            m = re.search(r"(\d{3})", p)
            if m:
                level = min(int(m.group(1)) // 100, 4)
                level_min = {1: 1, 2: 2, 3: 4, 4: 6}.get(level, 0)  # map to TERM_ORDER index
                min_term_idx = max(min_term_idx, level_min)

    # Find a term that has room (≤3.25 credits)
    from uwaterloo import _load_course_cache
    course_cache = _load_course_cache()
    course_units = float(course_cache.get(nc, {}).get("units", 0.5) if course_cache.get(nc) else 0.5)

    assigned_term = None
    for idx in range(min_term_idx, len(TERM_ORDER)):
        term = TERM_ORDER[idx]
        term_credits = sum(
            float(course_cache.get(c, {}).get("units", 0.5) if course_cache.get(c) else 0.5)
            for c, t in term_assignments.items() if t == term
        )
        if term_credits + course_units <= 3.25:
            assigned_term = term
            break

    if not assigned_term:
        assigned_term = TERM_ORDER[-1]

    tier = TERM_TO_TIER.get(assigned_term, "core")

    # Position: place below existing courses in the term column
    term_col = TERM_ORDER.index(assigned_term)
    term_count = sum(1 for t in term_assignments.values() if t == assigned_term)

    uwflow = uwflow_ratings.get(nc) or get_uwflow_ratings_bulk([nc]).get(nc)
    course_rating = None
    if uwflow:
        course_rating = CourseRating(
            liked=uwflow.get("liked"),
            easy=uwflow.get("easy"),
            useful=uwflow.get("useful"),
            filled_count=uwflow.get("filled_count"),
        )

    # Map ESCO skills for this course
    esco_map = _map_courses_to_esco_skills({nc}, {nc: {"code": code, "title": title}}, goal, api_key, model)

    node = SkillNode(
        id=nc.lower(),
        labels=[code],
        tier=tier,
        term=assigned_term,
        course=Course(
            title=title,
            url=f"https://uwflow.com/course/{nc.lower()}",
            reason=reason,
            units=course_units,
            rating=course_rating,
        ),
        position=Position(x=term_col * 440, y=term_count * 220),
        esco_skills=esco_map.get(nc, [skill]),
    )

    return {
        "node": node.model_dump(),
        "edge_sources": prereqs,
        "term": assigned_term,
    }


def _pick_defaults(choice_groups: list[dict], program_subjects: set[str] | None = None) -> dict[str, str]:
    """No goal provided — just pick the first N courses from each group."""
    picks: dict[str, str] = {}
    for group in choice_groups:
        if not group.get("courses"):
            expanded = _expand_elective_group(group)
            if expanded:
                group["courses"] = expanded
        n = int(group["rule"])
        courses = group.get("courses", [])
        # Pick first N, then swap out any inaccessible ones
        selected = courses[:n]
        remaining = courses[n:]
        final = []
        for c in selected:
            if _is_accessible(c["code"], program_subjects or set()):
                final.append(c)
            else:
                # Find next accessible replacement from remaining
                replacement = None
                while remaining:
                    candidate = remaining.pop(0)
                    if _is_accessible(candidate["code"], program_subjects or set()):
                        replacement = candidate
                        break
                final.append(replacement if replacement else c)
        for c in final:
            picks[c["code"]] = "Default selection"
    return picks


def _pick_electives(
    choice_groups: list[dict],
    goal: str,
    api_key: str,
    model: str,
    program_subjects: set[str] | None = None,
    major_title: str = "",
    desired_skills: list[str] | None = None,
    my_skills: list[str] | None = None,
) -> dict[str, str]:
    """LLM picks N courses from each choice group based on the student's goal and desired skills."""
    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)

    # Build group descriptions for LLM — no accessibility filtering here
    groups_desc = []
    group_courses: list[list[dict]] = []  # parallel list of course objects per group

    # Pre-fetch UWFlow ratings for all candidate courses
    all_candidate_codes: list[str] = []
    for group in choice_groups:
        for c in group.get("courses", []):
            all_candidate_codes.append(c["code"])
    uwflow_ratings = get_uwflow_ratings_bulk(all_candidate_codes)

    for i, group in enumerate(choice_groups):
        n = int(group["rule"])
        expanded = _expand_elective_group(group)
        if expanded:
            group["courses"] = expanded
        courses = group.get("courses", [])
        trimmed = _downselect_elective_options(courses, goal)
        group_courses.append(trimmed)
        options = []
        for c in trimmed:
            line = f"{c['code']} — {c.get('title', c['code'])}"
            rating_str = format_uwflow_rating(uwflow_ratings.get(c['code'].replace(' ', '').upper()))
            if rating_str:
                line += f" {rating_str}"
            options.append(line)
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
                    "select the courses that best align with the student's program and goal.\n\n"
                    "Rules:\n"
                    "- When a group offers regular vs honours/advanced variants, pick the one matching the program level "
                    "(e.g. Honours programs get Honours-level courses like MATH 137, not MATH 127).\n"
                    "- For breadth/free elective groups, pick courses that complement the student's program and goal. "
                    "Do NOT pick courses from unrelated professional fields (e.g. no accounting, actuarial, nursing, etc. for a CS student). "
                    "Prefer courses that build transferable skills relevant to the goal.\n"
                    "- Some courses include UWFlow student ratings (liked %, useful %, easy %, review count). "
                    "Use these as a signal — prefer courses that are well-liked and useful, "
                    "but prioritize goal alignment over raw ratings.\n"
                    "- If the student has specified desired skills, STRONGLY prefer courses that teach those skills. "
                    "Avoid courses that primarily teach skills the student already has.\n\n"
                    "IMPORTANT: You MUST return EXACTLY N picks for EACH group — no fewer, no more. "
                    "Every group must be fully filled. If you cannot find N perfectly aligned courses, "
                    "still pick the best available options from that group.\n\n"
                    "Return ONLY valid JSON, no other text. Schema:\n"
                    '{"picks": [{"code": "COURSE_CODE", "reason": "One sentence why"}]}'
                ),
            },
            {
                "role": "user",
                "content": (
                    (f"Program: {major_title}\n" if major_title else "")
                    + f"Goal: {goal}\n"
                    + (f"Desired skills to develop: {', '.join(desired_skills)}\n" if desired_skills else "")
                    + (f"Skills already acquired: {', '.join(my_skills)}\n" if my_skills else "")
                    + "\n" + "\n".join(groups_desc)
                ),
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

    logging.info("LLM elective raw response (len=%d): %s", len(raw), raw[:500])
    data = json.loads(raw)
    raw_picks = {p["code"]: p.get("reason", "") for p in data.get("picks", [])}

    # Enforce per-group limits: keep at most N picks from each choice group
    picks: dict[str, str] = {}
    for group in choice_groups:
        n = int(group["rule"])
        group_codes = {_normalize_code(c["code"]) for c in group.get("courses", [])}
        count = 0
        for code, reason in raw_picks.items():
            if _normalize_code(code) in group_codes:
                if count < n:
                    picks[code] = reason
                    count += 1

    # Fill under-filled groups from the downselected (goal-relevant) candidate list
    picked_normalized = {_normalize_code(c) for c in picks}
    for gi, group in enumerate(choice_groups):
        n = int(group["rule"])
        group_codes_set = {_normalize_code(c["code"]) for c in group.get("courses", [])}
        count = sum(1 for c in picked_normalized if c in group_codes_set)
        if count >= n:
            continue
        needed = n - count
        logging.warning(
            "LLM under-picked group %d (%s): got %d/%d, filling %d from downselected list",
            gi + 1, group.get("description", "")[:60], count, n, needed,
        )
        for c in group_courses[gi]:
            if needed <= 0:
                break
            nc = _normalize_code(c["code"])
            if nc not in picked_normalized:
                picks[c["code"]] = "Auto-filled from goal-relevant candidates"
                picked_normalized.add(nc)
                needed -= 1

    # Only check accessibility on the LLM's picks, not every candidate
    all_options = [c for group in group_courses for c in group]
    picked_codes = set(picks.keys())
    for code in list(picks.keys()):
        if not _is_accessible(code, program_subjects or set()):
            # Swap with first accessible alternative not already picked
            for alt in all_options:
                if alt["code"] not in picked_codes and _is_accessible(alt["code"], program_subjects or set()):
                    picks[alt["code"]] = picks.pop(code)
                    picked_codes.discard(code)
                    picked_codes.add(alt["code"])
                    break
            else:
                # No accessible replacement found — keep the original
                pass

    return picks


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
        return list_courses_excluding_subjects(exclude)

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

    # Only pad with non-matching courses if we don't have enough relevant ones.
    # Use a much smaller limit for filler to avoid drowning the LLM with garbage.
    if len(top) >= 20:
        return top
    remaining = [c for score, _, c in scored if score <= 0]
    filler_limit = max(limit - len(top), 20)
    return (top + remaining[:filler_limit])[:limit]
