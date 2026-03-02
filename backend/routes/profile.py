import logging
import os
import json
from flask import Blueprint, request, jsonify
from openrouter import OpenRouter
from dotenv import load_dotenv
from services.skill_matcher import match_skills
from config.db import supabase

load_dotenv()

logger = logging.getLogger(__name__)

profile_bp = Blueprint("profile", __name__)

TABLE = "user_profiles"


def extract_profile_from_bio(bio: str) -> dict:
    """Call OpenRouter LLM to extract structured profile from bio text."""
    with OpenRouter(api_key=os.environ["OPENROUTER_API_KEY"]) as client:
        response = client.chat.send(
            model="minimax/minimax-m2",
            messages=[
                {
                    "role": "system",
                    "content": """You are a profile extraction assistant. Given a user's bio or description, extract:
1. Their goal (what they want to learn or achieve)
2. Their current skills (what they already know)

Return ONLY valid JSON in this exact format:
{
  "goal": "string describing their learning/career goal",
  "current_skills": [
    {"label": "skill name"},
    {"label": "another skill"}
  ]
}

If no goal is mentioned, use an empty string. If no skills are mentioned, use an empty array.""",
                },
                {"role": "user", "content": bio},
            ],
        )
        return response.choices[0].message.content


def clean_llm_json_response(content: str) -> str:
    """Remove markdown code fences from LLM response."""
    content = content.strip()
    if content.startswith("```json"):
        content = content[7:]
    if content.startswith("```"):
        content = content[3:]
    if content.endswith("```"):
        content = content[:-3]
    return content.strip()


def validate_profile_structure(profile: dict) -> None:
    """Validate that profile has required fields and correct types."""
    if not isinstance(profile, dict):
        raise ValueError("LLM response is not a JSON object")
    if "goal" not in profile or "current_skills" not in profile:
        raise ValueError("Missing required fields (goal, current_skills)")
    if not isinstance(profile["current_skills"], list):
        raise ValueError("current_skills must be an array")


@profile_bp.route("/profile", methods=["POST"])
def build_profile():
    """Accept a bio and return a structured profile with extracted goal and skills."""
    data = request.get_json()
    if not data or "bio" not in data:
        return jsonify({"error": "Missing 'bio' field"}), 400

    bio = data["bio"]
    if not isinstance(bio, str) or not bio.strip():
        return jsonify({"error": "'bio' must be a non-empty string"}), 400

    try:
        llm_response = extract_profile_from_bio(bio)
        cleaned_json = clean_llm_json_response(llm_response)
        profile = json.loads(cleaned_json)
        validate_profile_structure(profile)

        # Semantic-match current skills from LLM-extracted labels (not raw bio)
        llm_skills = " ".join(s["label"] for s in profile["current_skills"] if s.get("label"))
        profile["current_skills"] = match_skills(llm_skills, top_k=5, threshold=0.45) if llm_skills else []

        # Semantic-match required skills from extracted goal
        goal = profile.get("goal", "")
        profile["required_skills"] = match_skills(goal, top_k=5, threshold=0.35) if goal else []

        return jsonify(profile), 200

    except json.JSONDecodeError as e:
        return jsonify({"error": f"Failed to parse LLM response as JSON: {str(e)}"}), 500
    except KeyError as e:
        return jsonify({"error": f"Missing environment variable: {str(e)}"}), 500
    except ValueError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Profile extraction failed: {str(e)}"}), 500


# ── Profile CRUD (Supabase) ────────────────────────────────────────────


def _require_supabase():
    if supabase is None:
        return jsonify({"error": "database not configured"}), 503
    return None


@profile_bp.route("/profile/<user_id>", methods=["GET"])
def get_profile(user_id: str):
    """Return the user's goal and skills."""
    err = _require_supabase()
    if err:
        return err

    result = (
        supabase.table(TABLE)
        .select("id, goal, current_skills")
        .eq("id", user_id)
        .execute()
    )

    if not result.data:
        return jsonify({"error": "profile not found"}), 404

    row = result.data[0]
    return jsonify({
        "id": row["id"],
        "goal": row.get("goal") or "",
        "skills": row.get("current_skills") or [],
    })


@profile_bp.route("/profile/<user_id>/skills", methods=["PUT"])
def set_skills(user_id: str):
    """Set the user's current skills.

    Expects: {"skills": ["Python", "SQL", ...]}
    """
    err = _require_supabase()
    if err:
        return err

    body = request.get_json(force=True)
    skills = body.get("skills")
    if skills is None or not isinstance(skills, list):
        return jsonify({"error": "skills must be a list"}), 400

    result = (
        supabase.table(TABLE)
        .update({"current_skills": skills})
        .eq("id", user_id)
        .execute()
    )

    if not result.data:
        return jsonify({"error": "profile not found"}), 404

    return jsonify({"skills": result.data[0].get("current_skills", [])})


@profile_bp.route("/profile/<user_id>/goal", methods=["PUT"])
def set_goal(user_id: str):
    """Set the user's learning goal.

    Expects: {"goal": "Become a data scientist"}
    """
    err = _require_supabase()
    if err:
        return err

    body = request.get_json(force=True)
    goal = body.get("goal")
    if goal is None or not isinstance(goal, str):
        return jsonify({"error": "goal must be a string"}), 400

    result = (
        supabase.table(TABLE)
        .update({"goal": goal})
        .eq("id", user_id)
        .execute()
    )

    if not result.data:
        return jsonify({"error": "profile not found"}), 404

    return jsonify({"goal": result.data[0].get("goal", "")})
