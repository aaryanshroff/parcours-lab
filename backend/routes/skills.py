"""Skills route - returns the curated list of available skills."""

import csv
import logging
from pathlib import Path

from flask import Blueprint, jsonify

logger = logging.getLogger(__name__)

skills_bp = Blueprint("skills", __name__)

SKILLS_CSV = Path(__file__).parent.parent / "data" / "processed" / "skills" / "skills_retained.csv"

_skills_cache: list[dict] | None = None


def _load_skills() -> list[dict]:
    global _skills_cache
    if _skills_cache is not None:
        return _skills_cache

    skills = []
    with open(SKILLS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            skills.append({
                "uri": row["conceptUri"],
                "label": row["preferredLabel"],
                "altLabels": row.get("altLabels", ""),
            })

    skills.sort(key=lambda s: s["label"].lower())
    _skills_cache = skills
    logger.info("loaded %d available skills", len(skills))
    return _skills_cache


@skills_bp.route("/skills", methods=["GET"])
def list_skills():
    """Return all available skills for the dropdown selector."""
    try:
        skills = _load_skills()
        return jsonify(skills)
    except FileNotFoundError:
        logger.error("skills CSV not found at %s", SKILLS_CSV)
        return jsonify({"error": "skills data not available"}), 503
