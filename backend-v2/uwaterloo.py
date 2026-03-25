import json
import os
import re
from functools import lru_cache
from pathlib import Path

import requests

DATA_PATH = Path(__file__).resolve().parent / "data" / "programs.json"
COURSE_CACHE_PATH = Path(__file__).resolve().parent / "data" / "course_cache.json"

UW_BASE = "https://openapi.data.uwaterloo.ca/v3"


@lru_cache(maxsize=1)
def _load_data() -> dict:
    with DATA_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _load_course_cache() -> dict:
    if COURSE_CACHE_PATH.exists():
        with COURSE_CACHE_PATH.open(encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_course_cache(cache: dict) -> None:
    COURSE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with COURSE_CACHE_PATH.open("w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)


def search_programs(
    query: str = "",
    credential_type: str | None = None,
    field_of_study: str | None = None,
) -> list[dict]:
    data = _load_data()
    q = query.lower()
    results = []
    for prog in data["programs"]:
        if credential_type and prog.get("credentialType") != credential_type:
            continue
        if field_of_study and prog.get("fieldOfStudy") != field_of_study:
            continue
        if q and q not in prog["title"].lower() and q not in prog["code"].lower() and q not in prog.get("faculty", "").lower():
            continue
        results.append({
            "pid": prog["pid"],
            "title": prog["title"],
            "credentialType": prog["credentialType"],
            "faculty": prog.get("faculty", ""),
            "fieldOfStudy": prog.get("fieldOfStudy", ""),
        })
    return results[:20]


def get_program(pid: str) -> dict | None:
    data = _load_data()
    for prog in data["programs"]:
        if prog["pid"] == pid:
            return prog
    return None


def _parse_course_code(code: str) -> tuple[str, str]:
    """Split 'CS135' or 'MATH 137' into (subject, catalog_number)."""
    m = re.match(r"([A-Z]+)\s*(\d+\w*)", code)
    if m:
        return m.group(1), m.group(2)
    return code, ""


def _parse_requirements_text(text: str) -> dict:
    if not text:
        return {"prereqs": [], "coreqs": [], "antireqs": []}

    def extract_section(label: str) -> str:
        pattern = rf"{label}:\s*(.+?)(?=(?:Prereq:|Coreq:|Antireq:|$))"
        m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        return m.group(1).strip() if m else ""

    def extract_courses(section: str) -> list[str]:
        return re.findall(r"[A-Z]{2,}\s*\d{3}[A-Z]?", section)

    return {
        "prereqs": extract_courses(extract_section("Prereq")),
        "coreqs": extract_courses(extract_section("Coreq")),
        "antireqs": extract_courses(extract_section("Antireq")),
    }


def _uw_headers() -> dict:
    return {"x-api-key": os.environ["UWATERLOO_API_KEY"], "accept": "application/json"}


def _get_current_term() -> str:
    resp = requests.get(f"{UW_BASE}/Terms/current", headers=_uw_headers(), timeout=15)
    resp.raise_for_status()
    return resp.json().get("termCode")


def _fetch_course_from_api(code: str) -> dict | None:
    subject, catalog_num = _parse_course_code(code)
    if not catalog_num:
        return None

    term = _get_current_term()
    resp = requests.get(
        f"{UW_BASE}/Courses/{term}/{subject}/{catalog_num}",
        headers=_uw_headers(),
        timeout=15,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()

    data = resp.json()
    # API may return a list or a single object
    course = data[0] if isinstance(data, list) and data else data
    req_text = course.get("requirementsDescription") or ""

    return {
        "code": code,
        "raw": req_text,
        **_parse_requirements_text(req_text),
    }


def get_course_prereqs(code: str) -> dict | None:
    """Get prereqs for a course, using disk cache. Fetches from UW API on cache miss."""
    cache = _load_course_cache()

    if code in cache:
        return cache[code]

    result = _fetch_course_from_api(code)
    if result:
        cache[code] = result
        _save_course_cache(cache)

    return result
