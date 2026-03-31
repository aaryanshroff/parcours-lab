import json
import os
import re
from functools import lru_cache
from pathlib import Path

import requests

DATA_PATH = Path(__file__).resolve().parent / "data" / "programs.json"
COURSE_CACHE_PATH = Path(__file__).resolve().parent / "data" / "course_cache.json"
SUBJECT_CACHE_PATH = Path(__file__).resolve().parent / "data" / "subject_course_cache.json"

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


def _load_subject_cache() -> dict:
    if SUBJECT_CACHE_PATH.exists():
        try:
            with SUBJECT_CACHE_PATH.open(encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            # Corrupt or partially-written cache; reset it.
            return {}
    return {}


def _save_subject_cache(cache: dict) -> None:
    SUBJECT_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with SUBJECT_CACHE_PATH.open("w", encoding="utf-8") as f:
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
        # Match full codes (CS 240) and bare catalog numbers (240E) that inherit the previous subject
        courses: list[str] = []
        last_subject = ""
        for m in re.finditer(r"([A-Z]{2,})\s*(\d{3}[A-Z]?)|(?<!\w)(\d{3}[A-Z]?)(?!\w)", section):
            if m.group(1):
                last_subject = m.group(1)
                courses.append(f"{m.group(1)} {m.group(2)}")
            elif m.group(3) and last_subject:
                courses.append(f"{last_subject} {m.group(3)}")
        return courses

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


def list_courses_by_subject(subject: str) -> list[dict]:
    """List courses for a subject in the current term using UW API (cached on disk)."""
    subject = subject.upper().strip()
    if not subject:
        return []

    cache = _load_subject_cache()
    if subject in cache:
        cleaned = [c for c in cache[subject] if _is_valid_course_code(c.get("code", ""))]
        if len(cleaned) != len(cache[subject]):
            cache[subject] = cleaned
            _save_subject_cache(cache)
        if cleaned:
            return cleaned
        # Empty cache entry: try local fallback before returning.
        fallback = _list_courses_from_local_data(subject)
        if fallback:
            cache[subject] = fallback
            _save_subject_cache(cache)
        return fallback

    term = _get_current_term()
    resp = requests.get(
        f"{UW_BASE}/Courses/{term}/{subject}",
        headers=_uw_headers(),
        timeout=20,
    )
    if resp.status_code == 404:
        return []
    resp.raise_for_status()

    payload = resp.json()
    if isinstance(payload, dict):
        for key in ("data", "courses", "items", "result"):
            if isinstance(payload.get(key), list):
                payload = payload[key]
                break

    if not isinstance(payload, list):
        return []

    courses: list[dict] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        subject_code = (
            item.get("subjectCode")
            or item.get("subject")
            or item.get("subject_code")
            or subject
        )
        catalog = (
            item.get("catalogNumber")
            or item.get("catalog_number")
            or item.get("catalog")
        )
        code = item.get("courseCode")
        if not code and catalog:
            code = f"{subject_code} {catalog}"
        if not code or not _is_valid_course_code(str(code)):
            continue

        title = (
            item.get("title")
            or item.get("courseTitle")
            or item.get("course_name")
            or item.get("courseName")
            or ""
        )

        units = (
            item.get("units")
            or item.get("credit")
            or item.get("credits")
            or item.get("unit")
        )
        if isinstance(units, dict):
            units = units.get("value")
        try:
            units = float(units) if units is not None else None
        except (TypeError, ValueError):
            units = None

        courses.append({"code": str(code), "title": str(title), "units": units})

    if not courses:
        courses = _list_courses_from_local_data(subject)

    cache[subject] = courses
    _save_subject_cache(cache)
    return courses


def _is_valid_course_code(code: str) -> bool:
    code = str(code).strip().upper()
    return bool(re.match(r"^[A-Z]{2,}\s*\d{3}[A-Z]?$", code))


def _list_courses_from_local_data(subject: str) -> list[dict]:
    """Fallback to locally scraped program data when UW API is unavailable."""
    data = _load_data()
    seen: dict[str, dict] = {}
    for prog in data.get("programs", []):
        for group in prog.get("requirementGroups", []):
            for c in group.get("courses", []):
                code = str(c.get("code", "")).strip()
                if not code:
                    continue
                if not _is_valid_course_code(code):
                    continue
                if _extract_subject(code) != subject:
                    continue
                key = code.replace(" ", "").upper()
                seen[key] = {
                    "code": code,
                    "title": c.get("title", ""),
                    "units": c.get("units"),
                }
    return list(seen.values())


def list_courses_excluding_subjects(exclude_subjects: set[str]) -> list[dict]:
    """Return courses from local program data excluding specified subjects."""
    data = _load_data()
    seen: dict[str, dict] = {}
    for prog in data.get("programs", []):
        for group in prog.get("requirementGroups", []):
            for c in group.get("courses", []):
                code = str(c.get("code", "")).strip()
                if not code or not _is_valid_course_code(code):
                    continue
                subject = _extract_subject(code)
                if subject in exclude_subjects:
                    continue
                key = code.replace(" ", "").upper()
                seen[key] = {
                    "code": code,
                    "title": c.get("title", ""),
                    "units": c.get("units"),
                }
    return list(seen.values())


def _extract_subject(code: str) -> str:
    m = re.match(r"^([A-Z]{2,})", code.strip().upper())
    return m.group(1) if m else ""
