import json
import os
import re
from functools import lru_cache
from pathlib import Path

import requests

DATA_PATH = Path(__file__).resolve().parent / "data" / "programs.json"
COURSE_CACHE_PATH = Path(__file__).resolve().parent / "data" / "course_cache.json"
SUBJECT_CACHE_PATH = Path(__file__).resolve().parent / "data" / "subject_course_cache.json"
UWFLOW_RATING_CACHE_PATH = Path(__file__).resolve().parent / "data" / "uwflow_rating_cache.json"
ALL_COURSES_PATH = Path(__file__).resolve().parent / "data" / "all_courses.json"

UWFLOW_GRAPHQL_URL = "https://uwflow.com/graphql"
UWFLOW_RATING_TTL_SECONDS = 7 * 24 * 60 * 60  # 7 days

UW_BASE = "https://openapi.data.uwaterloo.ca/v3"


@lru_cache(maxsize=1)
def _load_data() -> dict:
    with DATA_PATH.open(encoding="utf-8") as f:
        return json.load(f)


_course_cache_mem: dict | None = None


def _load_course_cache() -> dict:
    global _course_cache_mem
    if _course_cache_mem is not None:
        return _course_cache_mem
    if COURSE_CACHE_PATH.exists():
        try:
            with COURSE_CACHE_PATH.open(encoding="utf-8") as f:
                _course_cache_mem = json.load(f)
                return _course_cache_mem
        except json.JSONDecodeError:
            pass
    _course_cache_mem = {}
    return _course_cache_mem


def _save_course_cache(cache: dict) -> None:
    global _course_cache_mem
    _course_cache_mem = cache
    COURSE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = COURSE_CACHE_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)
    tmp.replace(COURSE_CACHE_PATH)


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


@lru_cache(maxsize=1)
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


# ── Full catalog search ──────────────────────────────────────────────────────

_all_courses_mem: list[dict] | None = None


def _load_all_courses() -> list[dict]:
    global _all_courses_mem
    if _all_courses_mem is not None:
        return _all_courses_mem
    if ALL_COURSES_PATH.exists():
        try:
            with ALL_COURSES_PATH.open(encoding="utf-8") as f:
                _all_courses_mem = json.load(f)
                return _all_courses_mem
        except json.JSONDecodeError:
            pass
    _all_courses_mem = []
    return _all_courses_mem


def search_courses_by_title(queries: list[str]) -> list[dict]:
    """Search the full course catalog for courses whose titles match any query.

    Each query is matched as a case-insensitive substring against the title.
    Returns a deduplicated list of matching courses.
    """
    catalog = _load_all_courses()
    if not catalog or not queries:
        return []

    lower_queries = [q.lower() for q in queries if q.strip()]
    seen: set[str] = set()
    results: list[dict] = []
    for course in catalog:
        title_lower = course.get("title", "").lower()
        code = course.get("code", "")
        normalized = code.replace(" ", "").upper()
        if normalized in seen:
            continue
        if any(q in title_lower for q in lower_queries):
            seen.add(normalized)
            results.append(course)
    return results


# ── UWFlow ratings ────────────────────────────────────────────────────────────

import logging
import time

_uwflow_logger = logging.getLogger("uwflow_ratings")

_uwflow_rating_cache_mem: dict | None = None

UWFLOW_RATING_QUERY = """
query getCourseRating($code: String) {
  course(where: {code: {_eq: $code}}) {
    rating {
      liked
      easy
      useful
      filled_count
      comment_count
    }
    profs_teaching {
      prof {
        name
        rating {
          liked
        }
      }
    }
  }
}
"""


def _load_uwflow_rating_cache() -> dict:
    global _uwflow_rating_cache_mem
    if _uwflow_rating_cache_mem is not None:
        return _uwflow_rating_cache_mem
    if UWFLOW_RATING_CACHE_PATH.exists():
        try:
            with UWFLOW_RATING_CACHE_PATH.open(encoding="utf-8") as f:
                _uwflow_rating_cache_mem = json.load(f)
                return _uwflow_rating_cache_mem
        except json.JSONDecodeError:
            pass
    _uwflow_rating_cache_mem = {}
    return _uwflow_rating_cache_mem


def _save_uwflow_rating_cache(cache: dict) -> None:
    global _uwflow_rating_cache_mem
    _uwflow_rating_cache_mem = cache
    UWFLOW_RATING_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = UWFLOW_RATING_CACHE_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)
    tmp.replace(UWFLOW_RATING_CACHE_PATH)


def _fetch_uwflow_rating_from_api(code: str) -> dict | None:
    """Fetch rating data for a single course from UWFlow GraphQL."""
    # UWFlow expects lowercase, no spaces: "cs135"
    uwflow_code = code.replace(" ", "").lower()
    try:
        resp = requests.post(
            UWFLOW_GRAPHQL_URL,
            json={
                "operationName": "getCourseRating",
                "query": UWFLOW_RATING_QUERY,
                "variables": {"code": uwflow_code},
            },
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        _uwflow_logger.warning("UWFlow API failed for %s: %s", code, e)
        return None

    courses = data.get("data", {}).get("course", [])
    if not courses:
        return None

    course = courses[0]
    rating = course.get("rating") or {}
    profs = []
    for pt in course.get("profs_teaching", []):
        prof = pt.get("prof", {})
        prof_rating = prof.get("rating", {})
        if prof.get("name"):
            profs.append({
                "name": prof["name"],
                "liked": prof_rating.get("liked"),
            })

    return {
        "liked": rating.get("liked"),
        "easy": rating.get("easy"),
        "useful": rating.get("useful"),
        "filled_count": rating.get("filled_count"),
        "comment_count": rating.get("comment_count"),
        "profs": profs,
    }


def fetch_uwflow_rating(code: str) -> dict | None:
    """Get UWFlow rating for a course. Uses disk cache with TTL."""
    normalized = code.replace(" ", "").upper()
    cache = _load_uwflow_rating_cache()
    entry = cache.get(normalized)

    if entry:
        fetched_at = entry.get("fetched_at", 0)
        if time.time() - fetched_at < UWFLOW_RATING_TTL_SECONDS:
            return entry.get("rating")

    rating = _fetch_uwflow_rating_from_api(code)
    cache[normalized] = {
        "fetched_at": time.time(),
        "rating": rating,
    }
    _save_uwflow_rating_cache(cache)
    return rating


def get_uwflow_ratings_bulk(codes: list[str]) -> dict[str, dict]:
    """Fetch UWFlow ratings for multiple courses. Returns {normalized_code: rating_dict}.

    Saves the cache once at the end instead of after every fetch to avoid
    rapid file writes that conflict with Flask's auto-reloader.
    Cache-miss fetches run concurrently via a thread pool.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    cache = _load_uwflow_rating_cache()
    results: dict[str, dict] = {}
    to_fetch: list[tuple[str, str]] = []  # (original_code, normalized)

    for code in codes:
        normalized = code.replace(" ", "").upper()
        entry = cache.get(normalized)

        if entry:
            fetched_at = entry.get("fetched_at", 0)
            if time.time() - fetched_at < UWFLOW_RATING_TTL_SECONDS:
                rating = entry.get("rating")
                if rating:
                    results[normalized] = rating
                continue

        to_fetch.append((code, normalized))

    if to_fetch:
        with ThreadPoolExecutor(max_workers=min(12, len(to_fetch))) as pool:
            future_to_norm = {
                pool.submit(_fetch_uwflow_rating_from_api, code): normalized
                for code, normalized in to_fetch
            }
            for fut in as_completed(future_to_norm):
                normalized = future_to_norm[fut]
                rating = fut.result()
                cache[normalized] = {
                    "fetched_at": time.time(),
                    "rating": rating,
                }
                if rating:
                    results[normalized] = rating

        _save_uwflow_rating_cache(cache)

    return results


def format_uwflow_rating(rating: dict | None) -> str:
    """Format a rating dict into a compact string for LLM context."""
    if not rating:
        return ""
    parts = []
    if rating.get("liked") is not None:
        parts.append(f"{rating['liked']:.0%} liked")
    if rating.get("useful") is not None:
        parts.append(f"{rating['useful']:.0%} useful")
    if rating.get("easy") is not None:
        parts.append(f"{rating['easy']:.0%} easy")
    if rating.get("filled_count"):
        parts.append(f"{rating['filled_count']} reviews")
    if not parts:
        return ""
    summary = f"[UWFlow: {', '.join(parts)}]"

    # Top prof by liked %
    profs = rating.get("profs", [])
    rated_profs = [p for p in profs if p.get("liked") is not None]
    if rated_profs:
        best = max(rated_profs, key=lambda p: p["liked"])
        summary += f" Top prof: {best['name']} ({best['liked']:.0%} liked)"

    return summary
