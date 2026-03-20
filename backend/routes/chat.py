from flask import Blueprint, g, request, jsonify
from pydantic import ValidationError
from middleware.auth import optional_auth, require_auth
from schemas.chat import ChatRequest
from services.llm import call_openrouter, get_reply_text, extract_tool_calls
from services.tools import TOOLS, build_system_instruction, resolve_tool_calls
from services.courses import get_recommended_courses
from config.db import supabase

chat_bp = Blueprint("chat", __name__)


def _ensure_profile_row() -> None:
    """Create a minimal user_profiles row so conversation writes won't fail FK."""
    try:
        if not g.user:
            return
        supabase.table("user_profiles").upsert({
            "id": g.user.id,
            "email": g.user.email,
        }).execute()
    except Exception:
        pass


@chat_bp.route("/conversations/save", methods=["POST"])
@require_auth
def save_conversation():
    data = request.get_json(silent=True)
    messages = data.get("messages", []) if isinstance(data, dict) else []
    if not messages:
        return jsonify({"status": "noop"}), 200

    _ensure_profile_row()
    existing = (
        supabase.table("conversations")
        .select("id, messages")
        .eq("profile_id", g.user.id)
        .maybe_single()
        .execute()
    )
    existing_data = existing.data if (existing and existing.data) else None
    if existing_data:
        merged = (existing_data.get("messages") or []) + messages
        supabase.table("conversations").update({"messages": merged}).eq("id", existing_data["id"]).execute()
    else:
        supabase.table("conversations").insert({"profile_id": g.user.id, "messages": messages}).execute()

    return jsonify({"status": "saved"}), 200


@chat_bp.route("/conversations/me", methods=["GET"])
@require_auth
def get_my_conversation():
    result = (
        supabase.table("conversations")
        .select("messages")
        .eq("profile_id", g.user.id)
        .maybe_single()
        .execute()
    )
    messages = (result.data.get("messages") or []) if (result and result.data) else []
    return jsonify({"messages": messages}), 200


def _persist_messages(
    user_id: str,
    incoming_messages: list,
    assistant_text: str,
    skill_roadmap: dict | None = None,
) -> None:
    """Append the latest user + assistant turn to the user's conversation row."""
    try:
        _ensure_profile_row()
        user_message = next(
            (m for m in reversed(incoming_messages) if m.role == "user"), None
        )
        if not user_message:
            return

        assistant_msg: dict = {"role": "assistant", "content": assistant_text}
        if skill_roadmap:
            assistant_msg["skill_roadmap"] = skill_roadmap

        new_turns = [
            {"role": "user", "content": user_message.text_content()},
            assistant_msg,
        ]

        existing = (
            supabase.table("conversations")
            .select("id, messages")
            .eq("profile_id", user_id)
            .maybe_single()
            .execute()
        )

        existing_data = existing.data if (existing and existing.data) else None
        if existing_data:
            updated = (existing_data.get("messages") or []) + new_turns
            supabase.table("conversations").update({"messages": updated}).eq("id", existing_data["id"]).execute()
        else:
            supabase.table("conversations").insert({"profile_id": user_id, "messages": new_turns}).execute()
    except Exception:
        pass


@chat_bp.route("/chat", methods=["POST"])
@optional_auth
def chat():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid request body"}), 400

    try:
        req = ChatRequest.model_validate(data)
        system_instruction = build_system_instruction(req.course_history)
        model_messages: list[dict[str, object]] = [
            {"role": "system", "content": system_instruction},
            *req.to_openrouter_messages(),
        ]

        result = call_openrouter(model_messages, model=req.model, tools=TOOLS, tool_choice="auto")
        tool_calls = extract_tool_calls(result)

        conversation_id = g.user.id if g.user else req.conversation_id

        if tool_calls:
            assistant_text, skill_roadmap = resolve_tool_calls(
                tool_calls, model_messages, req.model,
                goal=req.goal, required_skills=req.required_skills,
                conversation_id=conversation_id,
                course_history=req.course_history,
            )
        else:
            assistant_text = get_reply_text(result)
            skill_roadmap = {}

        if g.user:
            _persist_messages(g.user.id, req.messages, assistant_text, skill_roadmap or None)

        response: dict = {"response": assistant_text}
        if skill_roadmap:
            response["skill_roadmap"] = skill_roadmap

        return response, 200
    except (ValueError, ValidationError) as e:
        return jsonify({"error": str(e)}), 400
    except EnvironmentError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Chat request failed: {str(e)}"}), 500


@chat_bp.route("/replace_course", methods=["POST"])
@optional_auth
def replace_course():
    """Find a replacement course for a rejected skill-course pairing."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid request"}), 400

    skill_name = data.get("skill_name", "")
    skill_description = data.get("skill_description", "")
    goal = data.get("goal", "")
    exclude_ids = set(data.get("exclude_course_ids", []))

    if not skill_name:
        return jsonify({"error": "skill_name is required"}), 400

    query = " ".join(filter(None, [goal, skill_name, skill_description]))
    candidates = get_recommended_courses(
        query, [skill_name], count=3,
        exclude_course_ids=exclude_ids,
    )

    if not candidates:
        return jsonify({"error": "No alternative courses available"}), 404

    return jsonify({"course": candidates[0]}), 200
