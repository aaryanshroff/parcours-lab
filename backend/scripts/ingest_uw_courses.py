"""Fetch UWaterloo course catalog data and save it as JSON.

Usage examples:
  poetry run python scripts/ingest_uw_courses.py --api-key "$UWATERLOO_API_KEY"
  poetry run python scripts/ingest_uw_courses.py --api-key "$UWATERLOO_API_KEY" --terms 1261,1265
  poetry run python scripts/ingest_uw_courses.py --api-key "$UWATERLOO_API_KEY" --subjects CS,ECE,MATH
  poetry run python scripts/ingest_uw_courses.py --api-key "$UWATERLOO_API_KEY" --terms 1261 --subjects CS,ECE
"""

from __future__ import annotations

import json
from pathlib import Path

import requests
import typer

BASE_URL = "https://openapi.data.uwaterloo.ca/v3"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "courses"


def fetch_json(path: str, api_key: str):
    try:
        resp = requests.get(
            f"{BASE_URL}{path}",
            headers={
                "x-api-key": api_key,
                "accept": "application/json",
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as err:
        raise RuntimeError(f"Request failed for {path}: {err}") from err


def resolve_term_codes(api_key: str, terms_override: str | None) -> list[str]:
    if terms_override:
        return [t.strip() for t in terms_override.split(",") if t.strip()]

    current_term = fetch_json("/Terms/current", api_key)
    term_code = current_term.get("termCode")
    if not term_code:
        raise RuntimeError("Could not determine current termCode from /Terms/current")
    return [term_code]


def fetch_courses_for_term(api_key: str, term_code: str, subjects: list[str] | None) -> list:
    if subjects:
        courses = []
        for subject in subjects:
            courses.extend(fetch_json(f"/Courses/{term_code}/{subject}", api_key))
        return courses
    else:
        return fetch_json(f"/Courses/{term_code}", api_key)


def main(
    api_key: str = typer.Option(
        ...,
        "--api-key",
        envvar="UWATERLOO_API_KEY",
        help="UWaterloo OpenData API key (or set UWATERLOO_API_KEY).",
    ),
    terms: str | None = typer.Option(
        None,
        "--terms",
        help="Comma-separated 4-digit Waterloo term codes (e.g., 1261,1265). Defaults to /Terms/current.",
    ),
    subjects: str | None = typer.Option(
        None,
        "--subjects",
        help="Comma-separated subject codes (e.g., CS,ECE,MATH). Defaults to all subjects.",
    ),
    output_dir: Path = typer.Option(
        DEFAULT_OUTPUT_DIR,
        "--output-dir",
        help="Directory to write output files. One file per term: uwaterloo_courses_<term>.json",
    ),
) -> None:
    term_codes = resolve_term_codes(api_key, terms)
    subject_list = [s.strip() for s in subjects.split(",") if s.strip()] if subjects else None

    output_dir.mkdir(parents=True, exist_ok=True)

    for term_code in term_codes:
        courses = fetch_courses_for_term(api_key, term_code, subject_list)
        output_path = output_dir / f"uwaterloo_courses_{term_code}.json"

        with output_path.open("w", encoding="utf-8") as f:
            json.dump({"courses": courses}, f, indent=2)

        subject_label = ",".join(subject_list) if subject_list else "all subjects"
        typer.echo(f"Saved {len(courses)} courses ({subject_label}) for term {term_code} -> {output_path}")


if __name__ == "__main__":
    typer.run(main)
