"""One-time pull of the full UWaterloo course catalog for the current term.

Writes a flat JSON array to data/all_courses.json with structure:
  [{"code": "BIOL 382", "title": "Bioinformatics", "units": 0.5}, ...]

Usage:
  UWATERLOO_API_KEY=... poetry run python scripts/pull_all_courses.py
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import requests

UW_BASE = "https://openapi.data.uwaterloo.ca/v3"
OUTPUT = Path(__file__).resolve().parent.parent / "data" / "all_courses.json"


def _headers() -> dict:
    key = os.environ.get("UWATERLOO_API_KEY")
    if not key:
        print("ERROR: UWATERLOO_API_KEY env var not set", file=sys.stderr)
        sys.exit(1)
    return {"x-api-key": key, "accept": "application/json"}


def _is_valid_code(code: str) -> bool:
    return bool(re.match(r"^[A-Z]{2,}\s*\d{3}[A-Z]?$", code.strip().upper()))


def main() -> None:
    headers = _headers()

    print("Fetching current term...")
    resp = requests.get(f"{UW_BASE}/Terms/current", headers=headers, timeout=15)
    resp.raise_for_status()
    term = resp.json().get("termCode")
    print(f"Current term: {term}")

    print(f"Fetching all courses for term {term} (this may take a moment)...")
    resp = requests.get(f"{UW_BASE}/Courses/{term}", headers=headers, timeout=60)
    resp.raise_for_status()

    payload = resp.json()
    if isinstance(payload, dict):
        for key in ("data", "courses", "items", "result"):
            if isinstance(payload.get(key), list):
                payload = payload[key]
                break

    if not isinstance(payload, list):
        print(f"ERROR: unexpected response type: {type(payload)}", file=sys.stderr)
        sys.exit(1)

    courses: list[dict] = []
    seen: set[str] = set()
    for item in payload:
        if not isinstance(item, dict):
            continue

        subject_code = (
            item.get("subjectCode")
            or item.get("subject")
            or item.get("subject_code")
            or ""
        )
        catalog = (
            item.get("catalogNumber")
            or item.get("catalog_number")
            or item.get("catalog")
        )
        code = item.get("courseCode")
        if not code and catalog and subject_code:
            code = f"{subject_code} {catalog}"
        if not code or not _is_valid_code(str(code)):
            continue

        code = str(code).strip().upper()
        normalized = code.replace(" ", "")
        if normalized in seen:
            continue
        seen.add(normalized)

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

        courses.append({"code": code, "title": str(title), "units": units})

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(courses, f, indent=2)

    print(f"Wrote {len(courses)} courses to {OUTPUT}")


if __name__ == "__main__":
    main()
