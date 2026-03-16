import logging
import os
import json
from flask import Blueprint, g, request, jsonify
from openrouter import OpenRouter
from dotenv import load_dotenv
from middleware.auth import optional_auth, require_auth
from services.skill_matcher import match_skills
from services.course_history_store import load_course_history, save_course_history
from config.db import supabase
from schemas.profile import BuildProfileRequest, SetSkillsRequest, SetGoalRequest
from utils import validate_request_body

load_dotenv()

logger = logging.getLogger(__name__)

profile_bp = Blueprint("profile", __name__)

TABLE = "user_profiles"


def extract_profile_from_bio(bio: str) -> dict:
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
    content = content.strip()
    if content.startswith("```json"):
        content = content[7:]
    if content.startswith("```"):
        content = content[3:]
    if content.endswith("```"):
        content = content[:-3]
    return content.strip()


def validate_profile_structure(profile: dict) -> None:
    if not isinstance(profile, dict):
        raise ValueError("LLM response is not a JSON object")
    if "goal" not in profile or "current_skills" not in profile:
        raise ValueError("Missing required fields (goal, current_skills)")
    if not isinstance(profile["current_skills"], list):
        raise ValueError("current_skills must be an array")


@profile_bp.route("/profile", methods=["POST"])
@optional_auth
@validate_request_body(BuildProfileRequest)
def build_profile(payload: BuildProfileRequest):
    try:
        llm_response = extract_profile_from_bio(payload.bio)
        cleaned_json = clean_llm_json_response(llm_response)
        profile = json.loads(cleaned_json)
        validate_profile_structure(profile)

        llm_skills = " ".join(s["label"] for s in profile["current_skills"] if s.get("label"))
        profile["current_skills"] = match_skills(llm_skills, top_k=5, threshold=0.45) if llm_skills else []

        goal = profile.get("goal", "")
        profile["required_skills"] = match_skills(goal, top_k=5, threshold=0.35) if goal else []

        if g.user:
            supabase.table(TABLE).upsert({
                "id": g.user.id,
                "email": g.user.email,
                "goal": goal,
                "current_skills": profile["current_skills"],
                "required_skills": profile["required_skills"],
            }).execute()

        return jsonify(profile), 200

    except json.JSONDecodeError as e:
        return jsonify({"error": f"Failed to parse LLM response as JSON: {str(e)}"}), 500
    except KeyError as e:
        return jsonify({"error": f"Missing environment variable: {str(e)}"}), 500
    except ValueError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Profile extraction failed: {str(e)}"}), 500


@profile_bp.route("/profile/save", methods=["POST"])
@require_auth
def save_profile():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid request body"}), 400

    existing = (
        supabase.table(TABLE)
        .select("goal, current_skills, required_skills")
        .eq("id", g.user.id)
        .maybe_single()
        .execute()
    )
    existing_data = existing.data if (existing and existing.data) else {}

    payload = {
        "id": g.user.id,
        "email": g.user.email,
        "goal": data["goal"] if "goal" in data else existing_data.get("goal", ""),
        "current_skills": (
            data["current_skills"] if "current_skills" in data else existing_data.get("current_skills", [])
        ),
        "required_skills": (
            data["required_skills"] if "required_skills" in data else existing_data.get("required_skills", [])
        ),
    }

    supabase.table(TABLE).upsert(payload).execute()

    if "course_history" in data:
        if not isinstance(data["course_history"], list):
            return jsonify({"error": "course_history must be a list"}), 400
        save_course_history(g.user.id, data["course_history"])

    return jsonify({"status": "saved"}), 200


@profile_bp.route("/profile/me", methods=["GET"])
@require_auth
def get_my_profile():
    result = (
        supabase.table(TABLE)
        .select("id, goal, current_skills, required_skills")
        .eq("id", g.user.id)
        .execute()
    )

    if not result.data:
        return jsonify({"error": "profile not found"}), 404

    row = result.data[0]
    course_history = load_course_history(g.user.id)
    return jsonify({
        "id": row["id"],
        "goal": row.get("goal") or "",
        "current_skills": row.get("current_skills") or [],
        "required_skills": row.get("required_skills") or [],
        "course_history": course_history,
    })


@profile_bp.route("/profile/<user_id>", methods=["GET"])
@require_auth
def get_profile(user_id: str):
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
@require_auth
@validate_request_body(SetSkillsRequest)
def set_skills(payload: SetSkillsRequest, user_id: str):
    result = (
        supabase.table(TABLE)
        .update({"current_skills": payload.skills})
        .eq("id", user_id)
        .execute()
    )

    if not result.data:
        return jsonify({"error": "profile not found"}), 404

    return jsonify({"skills": result.data[0].get("current_skills", [])})


@profile_bp.route("/profile/<user_id>/goal", methods=["PUT"])
@require_auth
@validate_request_body(SetGoalRequest)
def set_goal(payload: SetGoalRequest, user_id: str):
    result = (
        supabase.table(TABLE)
        .update({"goal": payload.goal})
        .eq("id", user_id)
        .execute()
    )

    if not result.data:
        return jsonify({"error": "profile not found"}), 404

    return jsonify({"goal": result.data[0].get("goal", "")})
