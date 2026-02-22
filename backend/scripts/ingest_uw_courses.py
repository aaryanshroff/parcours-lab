"""Fetch UWaterloo course catalog data for CS and save it as JSON.

Usage examples:
  poetry run python scripts/ingest_uw_courses.py --api-key "$UWATERLOO_API_KEY"
  poetry run python scripts/ingest_uw_courses.py --api-key "$UWATERLOO_API_KEY" --term 1261
"""

from __future__ import annotations

import json
from pathlib import Path

import requests
import typer

BASE_URL = "https://openapi.data.uwaterloo.ca/v3"
DEFAULT_SUBJECT = "CS"
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


def resolve_term_code(api_key: str, term_override: str | None) -> str:
    if term_override:
        return term_override

    current_term = fetch_json("/Terms/current", api_key)
    term_code = current_term.get("termCode")
    if not term_code:
        raise RuntimeError("Could not determine current termCode from /Terms/current")
    return term_code


def main(
    api_key: str = typer.Option(
        ...,
        "--api-key",
        envvar="UWATERLOO_API_KEY",
        help="UWaterloo OpenData API key (or set UWATERLOO_API_KEY).",
    ),
    term: str | None = typer.Option(
        None,
        "--term",
        help="4-digit Waterloo term code (e.g., 1261). Defaults to /Terms/current.",
    ),
    output: Path | None = typer.Option(
        None,
        "--output",
        help="Output path. Defaults to backend/data/raw/courses/uwaterloo_cs_courses_<term>.json",
    ),
) -> None:
    term_code = resolve_term_code(api_key, term)
    courses = fetch_json(f"/Courses/{term_code}/{DEFAULT_SUBJECT}", api_key)
    output_path = output or (DEFAULT_OUTPUT_DIR / f"uwaterloo_cs_courses_{term_code}.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", encoding="utf-8") as f:
        json.dump({"courses": courses}, f, indent=2)

    typer.echo(f"Saved {len(courses)} {DEFAULT_SUBJECT} courses for term {term_code} -> {output_path}")


if __name__ == "__main__":
    typer.run(main)
