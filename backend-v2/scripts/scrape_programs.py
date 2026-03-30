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


def parse_prose_elective(text: str) -> dict | None:
    """Parse prose rules like 'Complete 3 additional CS courses chosen from CS340-CS398'."""
    m = re.match(
        r"Complete\s+(\d+)\s+additional\s+(\w+)\s+courses?\s+chosen\s+from\s+(.+)",
        text, re.IGNORECASE,
    )
    if m:
        return {
            "rule": int(m.group(1)),
            "courses": [],
            "elective_type": "range",
            "subject": m.group(2).upper(),
            "description": text,
        }

    m = re.match(
        r"Complete\s+(\d+)\s+course\s+from\s+the\s+following:\s*(.+)",
        text, re.IGNORECASE,
    )
    if m:
        return {
            "rule": int(m.group(1)),
            "courses": [],
            "elective_type": "range",
            "subject": "",
            "description": text,
        }

    m = re.match(
        r"Complete\s+a\s+total\s+of\s+(\d+(?:\.\d+)?)\s+units?\s+of\s+non-math\s+courses",
        text, re.IGNORECASE,
    )
    if m:
        n_courses = int(float(m.group(1)) / 0.5)
        return {
            "rule": n_courses,
            "courses": [],
            "elective_type": "breadth",
            "description": text,
        }

    return None


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

    # If no courses found, try parsing as a prose elective rule
    if not courses:
        prose = parse_prose_elective(text)
        if prose:
            return prose

    return {"rule": rule, "courses": courses}


def parse_requirements_html(html: str) -> list[dict]:
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    groups = []

    rule_lis = soup.find_all("li", attrs={"data-test": re.compile(r"^ruleView-")})

    if rule_lis:
        for rule_li in rule_lis:
            group = parse_requirement_group(rule_li)
            if group["courses"]:
                groups.append(group)
    else:
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
