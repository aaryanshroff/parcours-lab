import logging
import os
import io
import json
from flask import Blueprint, g, request, jsonify
from openrouter import OpenRouter
from dotenv import load_dotenv
from middleware.auth import optional_auth, require_auth
from services.skill_matcher import match_skills
from services.llm import call_openrouter, get_reply_text
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


def parse_resume_text(file_bytes: bytes, filename: str) -> str:
    """Extract plain text from a PDF or DOCX file."""
    lower = filename.lower()
    if lower.endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(file_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    elif lower.endswith(".docx"):
        from docx import Document
        doc = Document(io.BytesIO(file_bytes))
        return "\n".join(p.text for p in doc.paragraphs)
    else:
        raise ValueError(f"Unsupported file type: {filename}")


def extract_skills_from_resume_text(text: str) -> list[dict]:
    """Ask the LLM to extract skills from resume text."""
    response = call_openrouter(
        model="minimax/minimax-m2",
        messages=[
            {
                "role": "system",
                "content": """You are a resume parsing assistant. Given resume text, extract a list of skills the person has.
Include technical skills, tools, programming languages, frameworks, and relevant soft skills.

Return ONLY valid JSON in this exact format:
{
  "skills": [
    {"label": "skill name"},
    {"label": "another skill"}
  ]
}

If no skills are found, return an empty array.""",
            },
            {"role": "user", "content": text[:16000]},
        ],
    )
    raw = get_reply_text(response)
    cleaned = clean_llm_json_response(raw)
    parsed = json.loads(cleaned)
    if not isinstance(parsed.get("skills"), list):
        raise ValueError("LLM did not return a skills array")
    return parsed["skills"]


def scrape_job_text(url: str) -> str:
    """Fetch a job posting URL via Jina reader (handles JS-rendered pages) and return plain text."""
    import requests as http_requests
    jina_url = f"https://r.jina.ai/{url}"
    headers = {"User-Agent": "Mozilla/5.0 (compatible; parcours-lab/1.0)", "Accept": "text/plain"}
    response = http_requests.get(jina_url, headers=headers, timeout=20)
    response.raise_for_status()
    return response.text


def infer_required_skills_from_goal(goal: str) -> list[dict]:
    """Ask the LLM to enumerate specific skills required to achieve the given career goal."""
    response = call_openrouter(
        model="minimax/minimax-m2",
        messages=[
            {
                "role": "system",
                "content": """You are a career skills advisor. Given a career goal, list the specific technical skills, tools, and knowledge areas a person would need to achieve it.

Return ONLY valid JSON in this exact format:
{
  "skills": [
    {"label": "skill name"},
    {"label": "another skill"}
  ]
}

Be specific — use precise skill names (e.g. "Python", "TensorFlow", "SQL") rather than vague phrases. Return 8-12 skills.""",
            },
            {"role": "user", "content": goal},
        ],
    )
    raw = get_reply_text(response)
    cleaned = clean_llm_json_response(raw)
    parsed = json.loads(cleaned)
    if not isinstance(parsed.get("skills"), list):
        raise ValueError("LLM did not return a skills array")
    logger.info("[infer_required_skills] goal=%r", goal)
    logger.info("[infer_required_skills] LLM returned skills: %s", [s.get("label") for s in parsed["skills"]])
    return parsed["skills"]


def match_skills_individually(raw_skills: list[dict], threshold: float = 0.5, max_results: int = 10) -> list[dict]:
    """Match each LLM-extracted skill label against ESCO individually, tracking source label."""
    matched = []
    seen = set()
    for skill in raw_skills:
        label = skill.get("label", "").strip()
        if not label:
            continue
        results = match_skills(label, top_k=1, threshold=threshold)
        if results:
            logger.info("[match_individually] %r -> %r (score=%.3f)", label, results[0]["label"], results[0]["score"])
        else:
            logger.info("[match_individually] %r -> no match above threshold", label)
        for r in results:
            if r["label"] not in seen:
                seen.add(r["label"])
                matched.append({**r, "input_label": label})
        if len(matched) >= max_results:
            break
    return matched


def filter_skill_matches_with_llm(matched: list[dict]) -> list[dict]:
    """Use LLM to filter out false-positive ESCO mappings.

    Each item in matched must have an 'input_label' (raw extracted term) and
    'label' (ESCO match) so the LLM can judge whether they are the same concept.
    """
    if not matched:
        return matched

    pairs = [{"extracted": m["input_label"], "esco": m["label"]} for m in matched]

    prompt = (
        "You are a skill taxonomy validator. Below are pairs of (extracted skill from a job posting) "
        "and the closest ESCO skill found via semantic search.\n\n"
        "Keep a pair ONLY if the ESCO skill is a genuine, close match for the extracted skill — "
        "same concept, just possibly different phrasing. Discard pairs where the ESCO skill is "
        "unrelated or only superficially similar.\n\n"
        f"Pairs:\n{json.dumps(pairs, indent=2)}\n\n"
        'Return ONLY a JSON array of approved ESCO labels, e.g. ["cyber security", "risk assessment"]. '
        "No markdown, no explanation."
    )

    try:
        result = call_openrouter(
            model="minimax/minimax-m2",
            messages=[{"role": "user", "content": prompt}],
        )
        raw = get_reply_text(result).strip()
        cleaned = clean_llm_json_response(raw)
        approved: list[str] = json.loads(cleaned)
        if not isinstance(approved, list):
            raise ValueError("not a list")
        approved_set = {label.lower() for label in approved if isinstance(label, str)}
        # Strip internal input_label before returning
        return [
            {k: v for k, v in m.items() if k != "input_label"}
            for m in matched
            if m.get("label", "").lower() in approved_set
        ]
    except Exception:
        logger.warning("LLM skill filter failed, returning unfiltered matches")
        return [{k: v for k, v in m.items() if k != "input_label"} for m in matched]


import re

_JOB_SECTION_PATTERNS = re.compile(
    r"(requirements|qualifications|responsibilities|what you.?ll need|"
    r"what we.?re looking for|skills|must have|nice to have|about the role)",
    re.IGNORECASE,
)


def _find_relevant_section(text: str, limit: int = 16000) -> str:
    """Return a window of text starting from the first relevant job section header."""
    match = _JOB_SECTION_PATTERNS.search(text)
    if match:
        start = max(match.start() - 200, 0)  # include a bit of context before the header
        return text[start : start + limit]
    return text[:limit]


def extract_skills_from_job_text(text: str) -> tuple[list[dict], str]:
    """Ask the LLM to extract required skills from a job posting. Returns (skills, raw_llm_response)."""
    response = call_openrouter(
        model="minimax/minimax-m2",
        messages=[
            {
                "role": "system",
                "content": """You are a job posting parser. Given job posting text, extract a list of skills, tools, technologies, and qualifications required for the role.

Return ONLY valid JSON in this exact format:
{
  "skills": [
    {"label": "skill name"},
    {"label": "another skill"}
  ]
}

If no skills are found, return an empty array.""",
            },
            {"role": "user", "content": _find_relevant_section(text)},
        ],
    )
    raw = get_reply_text(response)
    cleaned = clean_llm_json_response(raw)
    parsed = json.loads(cleaned)
    if not isinstance(parsed.get("skills"), list):
        raise ValueError("LLM did not return a skills array")
    return parsed["skills"], raw


@profile_bp.route("/job/parse", methods=["POST"])
@optional_auth
def parse_job():
    data = request.get_json(silent=True)
    if not data or not data.get("url"):
        return jsonify({"error": "Missing url"}), 400

    try:
        text = scrape_job_text(data["url"])
        if not text.strip():
            return jsonify({"error": "Could not extract text from job posting"}), 422

        raw_skills, raw_llm = extract_skills_from_job_text(text)
        matched = match_skills_individually(raw_skills, threshold=0.5, max_results=10)
        matched = filter_skill_matches_with_llm(matched)
        return jsonify({
            "skills": matched,
            "_debug": {
                "text_preview": text[:500],
                "text_length": len(text),
                "raw_llm": raw_llm,
            },
        }), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 422
    except Exception as e:
        logger.exception("Job parsing failed")
        return jsonify({"error": f"Job parsing failed: {str(e)}"}), 500


@profile_bp.route("/resume/parse", methods=["POST"])
@optional_auth
def parse_resume():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "Empty filename"}), 400

    try:
        file_bytes = file.read()
        text = parse_resume_text(file_bytes, file.filename)
        if not text.strip():
            return jsonify({"error": "Could not extract text from resume"}), 422

        raw_skills = extract_skills_from_resume_text(text)
        matched = match_skills_individually(raw_skills, threshold=0.65, max_results=10)
        return jsonify({"skills": matched}), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 422
    except Exception as e:
        logger.exception("Resume parsing failed")
        return jsonify({"error": f"Resume parsing failed: {str(e)}"}), 500


@profile_bp.route("/profile", methods=["POST"])
@optional_auth
@validate_request_body(BuildProfileRequest)
def build_profile(payload: BuildProfileRequest):
    try:
        llm_response = extract_profile_from_bio(payload.bio)
        cleaned_json = clean_llm_json_response(llm_response)
        profile = json.loads(cleaned_json)
        validate_profile_structure(profile)

        if payload.current_skills is not None:
            profile["current_skills"] = payload.current_skills
        else:
            llm_skills = " ".join(s["label"] for s in profile["current_skills"] if s.get("label"))
            profile["current_skills"] = match_skills(llm_skills, top_k=5, threshold=0.3) if llm_skills else []

        goal = profile.get("goal", "")
        if payload.required_skills is not None:
            profile["required_skills"] = payload.required_skills
        else:
            if goal:
                inferred = infer_required_skills_from_goal(goal)
                skill_str = " ".join(s["label"] for s in inferred if s.get("label"))
                logger.info("[build_profile] skill_str passed to match_skills: %r", skill_str)
                matched = match_skills(skill_str, top_k=5, threshold=0.45) if skill_str else []
                logger.info("[build_profile] match_skills returned: %s", [s.get("label") for s in matched])
                profile["required_skills"] = matched
            else:
                profile["required_skills"] = []

        # Subtract current_skills from required_skills to avoid overlap
        current_labels = {s.get("label", "").lower() for s in profile["current_skills"] if s.get("label")}
        profile["required_skills"] = [
            s for s in profile["required_skills"]
            if s.get("label", "").lower() not in current_labels
        ]

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
