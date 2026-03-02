import os
import json
from flask import Blueprint, request, jsonify
from openrouter import OpenRouter
from dotenv import load_dotenv
from services.skill_matcher import match_skills

load_dotenv()

profile_bp = Blueprint("profile", __name__)


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

        # Semantic-match current skills from bio text
        profile["current_skills"] = match_skills(bio, top_k=10, threshold=0.45)

        # Semantic-match required skills from extracted goal
        goal = profile.get("goal", "")
        profile["required_skills"] = match_skills(goal, top_k=15, threshold=0.35) if goal else []

        return jsonify(profile), 200

    except json.JSONDecodeError as e:
        return jsonify({"error": f"Failed to parse LLM response as JSON: {str(e)}"}), 500
    except KeyError as e:
        return jsonify({"error": f"Missing environment variable: {str(e)}"}), 500
    except ValueError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Profile extraction failed: {str(e)}"}), 500
