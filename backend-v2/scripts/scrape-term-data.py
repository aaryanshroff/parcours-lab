"""One-time scrape of UWaterloo program catalog from Kuali API.

Usage:
  poetry run python scripts/scrape_programs.py
  poetry run python scripts/scrape_programs.py --output data/programs.json
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from bs4 import BeautifulSoup

CATALOG_ID = "663290e835aff7001cc62323"
KUALI_BASE = f"https://uwaterloocm.kuali.co/api/v1/catalog"
KUALI_LIST_URL = f"{KUALI_BASE}/programs/{CATALOG_ID}"
KUALI_DETAIL_URL = f"{KUALI_BASE}/program/{CATALOG_ID}"

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data"


def fetch_program_list() -> list[dict]:
    resp = requests.get(KUALI_LIST_URL, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_program_detail(pid: str) -> dict:
    resp = requests.get(f"{KUALI_DETAIL_URL}/{pid}", timeout=30)
    resp.raise_for_status()
    return resp.json()


def parse_course_from_li(li) -> dict | None:
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


def parse_requirement_group(rule_li) -> dict:
    result_div = rule_li.find("div", attrs={"data-test": re.compile(r"ruleView-.*-result")})
    if not result_div:
        return {"rule": "unknown", "courses": []}

    text = result_div.get_text(" ", strip=True)

    complete_n = re.match(r"Complete\s+(\d+)\s+of", text)
    if "Complete all" in text:
        rule = "all"
    elif complete_n:
        rule = int(complete_n.group(1))
    else:
        rule = "unknown"

    courses = []
    for course_li in result_div.find_all("li"):
        if course_li.find("ul"):
            continue
        parsed = parse_course_from_li(course_li)
        if parsed:
            courses.append(parsed)

    return {"rule": rule, "courses": courses}


def parse_requirement_groups_from_soup(soup) -> list[dict]:
    """Extract requirementGroups from a BeautifulSoup subtree.

    Looks for <li data-test="ruleView-*"> elements — each one is a rule
    like "complete all" or "pick N". We search within the given subtree
    so this works whether we pass the full document or just one <section>.
    """
    groups = []
    rule_lis = soup.find_all("li", attrs={"data-test": re.compile(r"^ruleView-")})
    if rule_lis:
        for rule_li in rule_lis:
            group = parse_requirement_group(rule_li)
            if group["courses"]:
                groups.append(group)
    else:
        # Fallback: no ruleView markers, just grab every leaf <li> with a course link
        courses = []
        for li in soup.find_all("li"):
            if li.find("ul"):
                continue
            parsed = parse_course_from_li(li)
            if parsed:
                courses.append(parsed)
        if courses:
            groups.append({"rule": "all", "courses": courses})
    return groups


def parse_requirements_html(html: str) -> list[dict]:
    """Parse flat (non-term) requirements from courseRequirementsNoUnits."""
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    return parse_requirement_groups_from_soup(soup)


def parse_term_by_term_html(html: str) -> list[dict]:
    """Parse requiredCoursesTermByTerm into a list of per-term groups.

    The HTML is a series of <section> elements, each with:
      - <h2 data-testid="grouping-label"> containing the term name ("1A Term")
      - ruleView-* <li> elements containing the courses for that term

    We iterate sections, extract the term label from the <h2>,
    then reuse parse_requirement_groups_from_soup scoped to that section.
    """
    if not html or not html.strip():
        return []

    soup = BeautifulSoup(html, "html.parser")
    term_groups = []

    for section in soup.find_all("section"):
        # The term name lives in <h2 data-testid="grouping-label">
        h2 = section.find("h2", attrs={"data-testid": "grouping-label"})
        if not h2:
            continue
        term_name = h2.get_text(strip=True)  # e.g. "1A Term"

        # Parse rules scoped to this section only — not the whole document
        req_groups = parse_requirement_groups_from_soup(section)
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

        return {
            "pid": pid,
            "code": prog.get("code", ""),
            "title": prog.get("title", ""),
            "credentialType": credential.get("name", ""),
            "faculty": faculty.get("name", ""),
            "fieldOfStudy": field.get("name", ""),
            # For programs with a fixed term sequence (e.g. engineering):
            # termGroups is a list of {term, requirementGroups} — one entry per term.
            # For programs without a fixed sequence (e.g. CS, Math):
            # termGroups is empty and requirementGroups holds the flat list.
            "termGroups": parse_term_by_term_html(term_by_term_html),
            "requirementGroups": parse_requirements_html(requirements_html),
        }

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
