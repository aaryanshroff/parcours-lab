"""One-time scrape of UWaterloo program catalog from Kuali API.

Usage:
  poetry run python scripts/scrape-term-data.py
  poetry run python scripts/scrape-term-data.py --output data/programs.json

Rule format
-----------
Each requirement group has the shape:
  { "rule": <value>, "courses": [...], "groups": [...] }

rule values:
  "all"       — complete every course in the list
  N (int)     — complete exactly N courses / options from the list
  "credits"   — complete a number of credit units; see the "credits" field
  <str>       — raw Kuali text for rules that couldn't be classified

When rule == "credits" the group also has:
  "credits": <float>   — units required (e.g. 3.0)

"groups" is a list of nested RequirementGroup dicts.  Kuali nests rules in the
DOM (e.g. "Complete 1 of: [option-A courses] OR [option-B courses]") and this
structure is preserved recursively.

Exclusion courses are in the top-level "exclusions" list, not in groups.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup, Tag

CATALOG_ID = "663290e835aff7001cc62323"
KUALI_BASE = "https://uwaterloocm.kuali.co/api/v1/catalog"
KUALI_LIST_URL = f"{KUALI_BASE}/programs/{CATALOG_ID}"
KUALI_DETAIL_URL = f"{KUALI_BASE}/program/{CATALOG_ID}"

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"

_RV_RE = re.compile(r"^ruleView-")
_EXCLUSION_RE = re.compile(r"cannot be used towards this academic plan", re.IGNORECASE)
_CHOOSE_ANY_RE = re.compile(r"choose any|choose courses?\s+from", re.IGNORECASE)


# ── API fetches ────────────────────────────────────────────────────────────


def fetch_program_list() -> list[dict]:
    resp = requests.get(KUALI_LIST_URL, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_program_detail(pid: str) -> dict:
    resp = requests.get(f"{KUALI_DETAIL_URL}/{pid}", timeout=30)
    resp.raise_for_status()
    return resp.json()


# ── Course parsing ─────────────────────────────────────────────────────────


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


# ── Rule classification ────────────────────────────────────────────────────


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
        text, re.IGNORECASE,
    )
    if m:
        return {"rule": int(m.group(1))}

    # Preserve unit count rather than lossy-converting to course count
    m = re.search(r"complete\s+(\d+(?:\.\d+)?)\s+units?", text, re.IGNORECASE)
    if m:
        return {"rule": "credits", "credits": float(m.group(1))}

    # Pool marker — consumed by merge_sibling_pairs, never stored in output
    if _CHOOSE_ANY_RE.search(text):
        return {"rule": "_pool"}

    return {"rule": text}


# ── Group helpers ──────────────────────────────────────────────────────────


def _make_group(classification: dict, courses: list[dict], groups: list[dict] | None = None) -> dict:
    return {**classification, "courses": courses, "groups": groups or []}


def _get_header_text(li: Tag) -> str:
    """Extract rule header text (text before the course list) from a ruleView LI."""
    result_div = li.find("div", attrs={"data-test": re.compile(r"ruleView-.*-result")})
    if not result_div:
        return ""
    # The first direct <div> child usually contains only the rule text.
    # Using it avoids pulling in course titles from the course list below.
    header = result_div.find("div", recursive=False)
    return header.get_text(" ", strip=True) if header else result_div.get_text(" ", strip=True)[:150]


def _get_direct_courses(parent_li: Tag) -> list[dict]:
    """
    Collect course <li> elements that belong directly to parent_li's result div,
    skipping any that are inside a nested ruleView descendant.
    """
    result_div = parent_li.find("div", attrs={"data-test": re.compile(r"ruleView-.*-result")})
    if not result_div:
        return []

    courses = []
    for course_li in result_div.find_all("li"):
        if course_li.find("ul"):
            continue  # sub-group wrapper, not a leaf course
        # Skip if inside a nested ruleView (any ruleView ancestor before result_div)
        in_nested = False
        for anc in course_li.parents:
            if anc is result_div:
                break
            if _RV_RE.match(str(anc.get("data-test", ""))):
                in_nested = True
                break
        if in_nested:
            continue
        parsed = parse_course_from_li(course_li)
        if parsed:
            courses.append(parsed)
    return courses


def _get_direct_child_rule_lis(parent_li: Tag) -> list[Tag]:
    """
    Find ruleView LIs whose nearest ruleView ancestor (within parent_li) IS parent_li.
    These are the direct children in the requirement hierarchy.
    """
    result_div = parent_li.find("div", attrs={"data-test": re.compile(r"ruleView-.*-result")})
    if not result_div:
        return []

    children = []
    for candidate in result_div.find_all("li", attrs={"data-test": _RV_RE}):
        for anc in candidate.parents:
            if anc is parent_li:
                children.append(candidate)
                break
            if _RV_RE.match(str(anc.get("data-test", ""))):
                break  # closer ruleView ancestor found — not a direct child
    return children


# ── Sibling pair merging ───────────────────────────────────────────────────


def merge_sibling_pairs(groups: list[dict]) -> list[dict]:
    """
    Kuali sometimes expresses a requirement as two consecutive siblings:
      [i]   constraint  — has a real rule, NO courses, no child groups
      [i+1] pool        — rule "_pool" from "Choose any", HAS courses

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

    # Any remaining _pool (no preceding constraint) → pick 1
    return [{**g, "rule": 1} if g["rule"] == "_pool" else g for g in result]


# ── Recursive ruleView parsing ─────────────────────────────────────────────


def parse_ruleview_li(li: Tag) -> dict:
    """
    Recursively parse a ruleView LI into a group dict.

    Direct courses (not inside a nested ruleView) go into "courses".
    Direct child ruleView LIs are parsed recursively into "groups".
    """
    text = _get_header_text(li)
    classification = classify_rule(text)
    courses = _get_direct_courses(li)

    child_lis = _get_direct_child_rule_lis(li)
    child_groups = [parse_ruleview_li(c) for c in child_lis]
    child_groups = merge_sibling_pairs(child_groups)
    child_groups = [g for g in child_groups if g["courses"] or g["groups"]]

    return _make_group(classification, courses, child_groups)


# ── Core parsing ───────────────────────────────────────────────────────────


def parse_requirement_groups_from_soup(soup) -> tuple[list[dict], list[dict]]:
    """
    Extract requirement groups from a BeautifulSoup subtree.

    Finds only TOP-LEVEL ruleView LIs (those with no ruleView ancestor within
    this subtree) and parses each recursively.

    Returns:
        groups     — list of group dicts
        exclusions — list of Course dicts that cannot count toward the plan
    """
    all_rvs = soup.find_all("li", attrs={"data-test": _RV_RE})

    # Filter to top-level only
    top_rvs: list[Tag] = []
    for li in all_rvs:
        is_top = True
        for anc in li.parents:
            if anc is soup:
                break
            if _RV_RE.match(str(anc.get("data-test", ""))):
                is_top = False
                break
        if is_top:
            top_rvs.append(li)

    if top_rvs:
        raw = [parse_ruleview_li(li) for li in top_rvs]
    else:
        # Fallback: bare HTML without ruleView structure
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

    exclusions = [c for g in raw if g["rule"] == "exclusion" for c in g["courses"]]
    groups = [g for g in raw if g["rule"] != "exclusion"]
    groups = merge_sibling_pairs(groups)
    groups = [g for g in groups if g["courses"] or g["groups"]]

    return groups, exclusions


# ── Top-level HTML parsers ─────────────────────────────────────────────────


def parse_requirements_html(html: str) -> tuple[list[dict], list[dict]]:
    """Parse courseRequirementsNoUnits HTML into (requirementGroups, exclusions)."""
    if not html:
        return [], []
    soup = BeautifulSoup(html, "html.parser")
    return parse_requirement_groups_from_soup(soup)


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


# ── Main scrape ────────────────────────────────────────────────────────────


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

        req_groups, exclusions = parse_requirements_html(requirements_html)

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
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR / "programs.json")
    args = parser.parse_args()
    scrape_all(args.output)
