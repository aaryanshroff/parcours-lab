"""One-time scrape of UWaterloo program catalog from Kuali API.

Usage:
  poetry run python scripts/scrape-term-data.py
  poetry run python scripts/scrape-term-data.py --output data/programs-NESTED.json

Rule format
-----------
Each requirement group has the shape:
  { "rule": <value>, "courses": [...], "groups": [...] }

rule values:
  "all"       - complete every course in the list
  N (int)     - complete exactly N courses / options from the list
  "credits"   - complete a number of credit units; see the "credits" field
  <str>       - raw Kuali text for rules that couldn't be classified

When rule == "credits" the group also has:
  "credits": <float>   - units required (e.g. 3.0)

"groups" is a list of nested RequirementGroup dicts. Kuali nests rules in the
DOM (for example, "Complete 1 of: [option-A courses] OR [option-B bundle]").

Programs may also include named course lists:
  "lists": {
    "List 1": [RequirementGroup, ...],
    "Approved Courses List": [RequirementGroup, ...]
  }

Exclusion courses are stored in the top-level "exclusions" list, not in groups.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

CATALOG_ID = "663290e835aff7001cc62323"
KUALI_BASE = "https://uwaterloocm.kuali.co/api/v1/catalog"
KUALI_LIST_URL = f"{KUALI_BASE}/programs/{CATALOG_ID}"
KUALI_DETAIL_URL = f"{KUALI_BASE}/program/{CATALOG_ID}"

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"
DEFAULT_OUTPUT_PATH = OUTPUT_DIR / "programs-NESTED2.json"

_RV_RE = re.compile(r"^ruleView-")
_EXCLUSION_RE = re.compile(r"cannot be used towards this academic plan", re.IGNORECASE)
_CHOOSE_ANY_RE = re.compile(r"choose any|choose courses?\s+from", re.IGNORECASE)


def fetch_program_list() -> list[dict]:
    resp = requests.get(KUALI_LIST_URL, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_program_detail(pid: str) -> dict:
    resp = requests.get(f"{KUALI_DETAIL_URL}/{pid}", timeout=30)
    resp.raise_for_status()
    return resp.json()


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def parse_course_from_li(li: Tag) -> dict | None:
    link = li.find("a")
    if not link:
        return None
    code = link.get_text(strip=True)
    full_text = li.get_text(" ", strip=True)
    m = re.match(r"^(\S+)\s*-\s*(.+?)\s*\((\d+(?:\.\d+)?)\)\s*$", full_text)
    if m:
        return {"code": m.group(1), "title": m.group(2).strip(), "units": float(m.group(3))}
    parts = full_text.split(" - ", 1)
    title = parts[1].strip() if len(parts) > 1 else ""
    title = re.sub(r"\s*\(\d+(?:\.\d+)?\)\s*$", "", title)
    return {"code": code, "title": title, "units": None}


def classify_rule(text: str) -> dict:
    """
    Classify a rule header text into a structured dict.

    Returns a partial group dict (without "courses"/"groups").
    Falls back to {"rule": text} for unrecognised patterns.
    """
    if _EXCLUSION_RE.search(text):
        return {"rule": "exclusion"}

    if re.search(r"complete all", text, re.IGNORECASE):
        return {"rule": "all"}

    m = re.search(r"complete\s+(\d+)\s+of\b", text, re.IGNORECASE)
    if m:
        return {"rule": int(m.group(1))}

    m = re.search(r"no more than\s+(\d+)", text, re.IGNORECASE)
    if m:
        return {"rule": int(m.group(1))}

    m = re.search(
        r"complete\s+(\d+)\s+(?:courses?\s+from|additional\s+courses?\s+from)",
        text,
        re.IGNORECASE,
    )
    if m:
        return {"rule": int(m.group(1))}

    m = re.search(r"complete\s+(\d+(?:\.\d+)?)\s+units?", text, re.IGNORECASE)
    if m:
        return {"rule": "credits", "credits": float(m.group(1))}

    if _CHOOSE_ANY_RE.search(text):
        return {"rule": "_pool"}

    return {"rule": text}


def _make_group(
    classification: dict,
    courses: list[dict],
    groups: list[dict] | None = None,
    list_refs: list[str] | None = None,
) -> dict:
    group = {**classification, "courses": courses, "groups": groups or []}
    if list_refs:
        group["listRefs"] = list_refs
    return group


def _extract_list_refs(text: str, known_list_names: list[str]) -> list[str]:
    normalized = _normalize_whitespace(text)
    refs: list[str] = []
    for name in known_list_names:
        aliases = [name]
        if name.lower().endswith(" list"):
            aliases.append(name[:-5])
        if any(re.search(rf"\b{re.escape(alias)}\b", normalized, re.IGNORECASE) for alias in aliases):
            refs.append(name)
    return list(dict.fromkeys(refs))


def _get_ruleview_result_div(li: Tag) -> Tag | None:
    return li.find("div", attrs={"data-test": re.compile(r"ruleView-.*-result")})


def _get_header_text(li: Tag) -> str:
    """Extract rule header text (text before the course list) from a ruleView LI."""
    result_div = _get_ruleview_result_div(li)
    if not result_div:
        return ""

    parts: list[str] = []
    for child in result_div.contents:
        if isinstance(child, NavigableString):
            text = _normalize_whitespace(str(child))
            if text:
                parts.append(text)
            continue
        if not isinstance(child, Tag):
            continue
        if child.name == "div":
            child_text = _normalize_whitespace(child.get_text(" ", strip=True))
            if child.find(["ul", "ol"]):
                break
            if child_text:
                parts.append(child_text)
            break
        text = _normalize_whitespace(child.get_text(" ", strip=True))
        if text:
            parts.append(text)

    return _normalize_whitespace(" ".join(parts))


def _get_wrapper_header_text(li: Tag) -> str:
    """Extract header text from a non-ruleView wrapper li."""
    parts: list[str] = []
    for child in li.contents:
        if isinstance(child, NavigableString):
            text = _normalize_whitespace(str(child))
            if text:
                parts.append(text)
            continue
        if not isinstance(child, Tag):
            continue
        if child.name in {"ul", "ol"}:
            break
        text = _normalize_whitespace(child.get_text(" ", strip=True))
        if text:
            parts.append(text)
    return _normalize_whitespace(" ".join(parts))


def _is_group_candidate(li: Tag) -> bool:
    if li.name != "li":
        return False
    if _RV_RE.match(str(li.get("data-test", ""))):
        return True
    child_list = li.find(["ul", "ol"], recursive=False)
    if not child_list:
        return False
    return bool(_get_wrapper_header_text(li))


def _get_direct_courses_from_ruleview(li: Tag) -> list[dict]:
    """
    Collect course <li> elements that belong directly to a ruleView result div,
    skipping anything inside nested groups.
    """
    result_div = _get_ruleview_result_div(li)
    if not result_div:
        return []

    courses: list[dict] = []
    for course_li in result_div.find_all("li"):
        if _is_group_candidate(course_li):
            continue
        in_nested_group = False
        for anc in course_li.parents:
            if anc is result_div:
                break
            if isinstance(anc, Tag) and _is_group_candidate(anc):
                in_nested_group = True
                break
        if in_nested_group:
            continue
        parsed = parse_course_from_li(course_li)
        if parsed:
            courses.append(parsed)
    return courses


def _get_direct_courses_from_wrapper(li: Tag) -> list[dict]:
    courses: list[dict] = []
    for child_list in li.find_all(["ul", "ol"], recursive=False):
        for child_li in child_list.find_all("li", recursive=False):
            if _is_group_candidate(child_li):
                continue
            parsed = parse_course_from_li(child_li)
            if parsed:
                courses.append(parsed)
    return courses


def _get_group_content_root(li: Tag) -> Tag:
    if _RV_RE.match(str(li.get("data-test", ""))):
        return _get_ruleview_result_div(li) or li
    return li


def _get_direct_child_group_lis(parent_li: Tag) -> list[Tag]:
    """
    Find child wrapper/ruleView LIs whose nearest group ancestor is parent_li.
    """
    root = _get_group_content_root(parent_li)
    children: list[Tag] = []
    for candidate in root.find_all("li"):
        if candidate is parent_li or not _is_group_candidate(candidate):
            continue
        for anc in candidate.parents:
            if anc is parent_li:
                children.append(candidate)
                break
            if anc is root:
                break
            if isinstance(anc, Tag) and _is_group_candidate(anc):
                break
    return children


def merge_sibling_pairs(groups: list[dict]) -> list[dict]:
    """
    Kuali sometimes expresses a requirement as two consecutive siblings:
      [i]   constraint  - has a real rule, NO courses, no child groups
      [i+1] pool        - rule "_pool" from "Choose any", HAS courses

    Merge: take the constraint's rule (and credits if present), take the pool's courses.
    Standalone _pool groups (no matching preceding constraint) become rule: 1.
    """
    result: list[dict] = []
    i = 0
    while i < len(groups):
        g = groups[i]
        nxt = groups[i + 1] if i + 1 < len(groups) else None
        if (
            nxt is not None
            and nxt["rule"] == "_pool"
            and nxt["courses"]
            and not g["courses"]
            and not g["groups"]
            and g["rule"] != "exclusion"
        ):
            merged = {k: v for k, v in g.items() if k not in ("courses", "groups")}
            merged["courses"] = nxt["courses"]
            merged["groups"] = []
            result.append(merged)
            i += 2
        else:
            result.append(g)
            i += 1

    return [{**g, "rule": 1} if g["rule"] == "_pool" else g for g in result]


def parse_group_li(li: Tag, known_list_names: list[str] | None = None) -> dict:
    """
    Recursively parse either a ruleView LI or an anonymous wrapper LI.
    """
    if _RV_RE.match(str(li.get("data-test", ""))):
        text = _get_header_text(li)
        courses = _get_direct_courses_from_ruleview(li)
    else:
        text = _get_wrapper_header_text(li)
        courses = _get_direct_courses_from_wrapper(li)

    classification = classify_rule(text)
    list_refs = _extract_list_refs(text, known_list_names or [])

    child_lis = _get_direct_child_group_lis(li)
    child_groups = [parse_group_li(child, known_list_names) for child in child_lis]
    child_groups = merge_sibling_pairs(child_groups)
    child_groups = [g for g in child_groups if _is_meaningful_group(g)]

    # If classified as a count or pool but has nothing to apply it to, the rule
    # text describes a subject-code / level-range filter — keep as raw text.
    if not courses and not child_groups and not list_refs:
        rule = classification.get("rule")
        if isinstance(rule, int) or rule == "_pool":
            classification = {"rule": text}

    return _make_group(classification, courses, child_groups, list_refs)


def _is_meaningful_group(group: dict) -> bool:
    if group["courses"] or group["groups"] or group.get("listRefs"):
        return True
    rule = group["rule"]
    if rule == "exclusion":
        return False
    if rule in {"all", "_pool"}:
        return False
    return True


def _strip_exclusions(groups: list[dict]) -> tuple[list[dict], list[dict]]:
    cleaned: list[dict] = []
    exclusions: list[dict] = []

    for group in groups:
        child_groups, child_exclusions = _strip_exclusions(group["groups"])
        exclusions.extend(child_exclusions)

        current = {**group, "groups": child_groups}
        if current["rule"] == "exclusion":
            exclusions.extend(current["courses"])
            continue
        if _is_meaningful_group(current):
            cleaned.append(current)

    return cleaned, exclusions


def parse_requirement_groups_from_soup(
    soup: BeautifulSoup | Tag,
    known_list_names: list[str] | None = None,
) -> tuple[list[dict], list[dict]]:
    """
    Extract requirement groups from a BeautifulSoup subtree.

    Finds top-level wrapper/ruleView LIs and parses each recursively.

    Returns:
        groups     - list of group dicts
        exclusions - list of Course dicts that cannot count toward the plan
    """
    all_group_lis = [li for li in soup.find_all("li") if _is_group_candidate(li)]

    top_group_lis: list[Tag] = []
    for li in all_group_lis:
        is_top = True
        for anc in li.parents:
            if anc is soup:
                break
            if isinstance(anc, Tag) and _is_group_candidate(anc):
                is_top = False
                break
        if is_top:
            top_group_lis.append(li)

    if top_group_lis:
        raw = [parse_group_li(li, known_list_names) for li in top_group_lis]
    else:
        courses = []
        for li in soup.find_all("li"):
            if li.find("ul"):
                continue
            parsed = parse_course_from_li(li)
            if parsed:
                courses.append(parsed)
        if courses:
            return [_make_group({"rule": "all"}, courses)], []
        return [], []

    groups = merge_sibling_pairs(raw)
    groups, exclusions = _strip_exclusions(groups)

    if len(groups) == 1 and groups[0]["rule"] == "all" and not groups[0]["courses"] and not groups[0].get("listRefs"):
        groups = groups[0]["groups"]

    return groups, exclusions


def _get_section_heading(section: Tag) -> str:
    header = section.find("header")
    if not header:
        return ""
    h2 = header.find("h2")
    if not h2:
        return ""
    return _normalize_whitespace(h2.get_text(" ", strip=True))


def _get_section_body_clone(section: Tag) -> BeautifulSoup:
    """Clone a section and drop nested sections so parsing stays section-local."""
    clone = BeautifulSoup(str(section), "html.parser")
    root = clone.find("section")
    if not root:
        return clone

    for nested in root.find_all("section"):
        if nested is root:
            continue
        nested.decompose()
    return clone


def _iter_named_list_sections(soup: BeautifulSoup) -> list[tuple[str, Tag]]:
    sections: list[tuple[str, Tag]] = []
    for section in soup.find_all("section"):
        heading = _get_section_heading(section)
        if not heading:
            continue
        if heading.lower() == "required courses":
            continue
        sections.append((heading, section))
    return sections


def parse_requirements_html(html: str) -> tuple[list[dict], list[dict], dict[str, list[dict]]]:
    """Parse courseRequirementsNoUnits HTML into (requirementGroups, exclusions, lists)."""
    if not html:
        return [], [], {}

    soup = BeautifulSoup(html, "html.parser")
    list_sections = _iter_named_list_sections(soup)
    known_list_names = [name for name, _ in list_sections]

    required_section = next(
        (section for section in soup.find_all("section") if _get_section_heading(section).lower() == "required courses"),
        None,
    )

    if required_section:
        req_scope = _get_section_body_clone(required_section)
        req_groups, exclusions = parse_requirement_groups_from_soup(req_scope, known_list_names)
    else:
        req_groups, exclusions = parse_requirement_groups_from_soup(soup, known_list_names)

    lists: dict[str, list[dict]] = {}
    for name, section in list_sections:
        section_scope = _get_section_body_clone(section)
        groups, _ = parse_requirement_groups_from_soup(section_scope, known_list_names)
        if groups:
            lists[name] = groups

    return req_groups, exclusions, lists


def parse_term_by_term_html(html: str) -> list[dict]:
    """
    Parse requiredCoursesTermByTerm into a list of per-term requirement groups.

    Each <section> with <h2 data-testid="grouping-label"> is one term.
    Parsing is scoped per section so sibling-pair merging works within each term.
    """
    if not html or not html.strip():
        return []

    soup = BeautifulSoup(html, "html.parser")
    term_groups: list[dict] = []

    for section in soup.find_all("section"):
        h2 = section.find("h2", attrs={"data-testid": "grouping-label"})
        if not h2:
            continue
        term_name = h2.get_text(strip=True)
        req_groups, _ = parse_requirement_groups_from_soup(section)
        if req_groups:
            term_groups.append({"term": term_name, "requirementGroups": req_groups})

    return term_groups


def scrape_all(output_path: Path) -> None:
    print("Fetching program list...")
    programs = fetch_program_list()
    print(f"Found {len(programs)} programs")

    def process_program(prog: dict) -> dict | None:
        pid = prog.get("pid")
        try:
            detail = fetch_program_detail(pid)
        except Exception as e:
            print(f"  ERROR {prog.get('code', '')}: {e}")
            return None

        requirements_html = detail.get("courseRequirementsNoUnits", "")
        term_by_term_html = detail.get("requiredCoursesTermByTerm", "")
        credential = detail.get("undergraduateCredentialType", {})
        faculty = detail.get("facultyCalendarDisplay", {})
        field = detail.get("fieldOfStudy", {})

        req_groups, exclusions, named_lists = parse_requirements_html(requirements_html)

        result: dict = {
            "pid": pid,
            "code": prog.get("code", ""),
            "title": prog.get("title", ""),
            "credentialType": credential.get("name", ""),
            "faculty": faculty.get("name", ""),
            "fieldOfStudy": field.get("name", ""),
            "termGroups": parse_term_by_term_html(term_by_term_html),
            "requirementGroups": req_groups,
        }
        if exclusions:
            result["exclusions"] = exclusions
        if named_lists:
            result["lists"] = named_lists
        return result

    results = []
    done = 0

    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(process_program, prog): prog for prog in programs}
        for future in as_completed(futures):
            done += 1
            result = future.result()
            if result:
                results.append(result)
            if done % 50 == 0 or done == len(programs):
                print(f"  {done}/{len(programs)} programs fetched")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump({"programs": results}, f, indent=2)

    print(f"Saved {len(results)} programs to {output_path}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    args = parser.parse_args()
    scrape_all(args.output)
