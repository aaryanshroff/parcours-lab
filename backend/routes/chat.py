from flask import Blueprint, g, request, jsonify
from pydantic import ValidationError
from middleware.auth import require_auth
from schemas.chat import ChatRequest
from services.llm import call_openrouter, get_reply_text, extract_tool_calls
from services.tools import TOOLS, build_system_instruction, resolve_tool_calls

chat_bp = Blueprint("chat", __name__)


@chat_bp.route("/chat", methods=["POST"])
@require_auth
def chat():
    """Accept chat messages and return assistant response."""
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

        user_id = g.user.id

        if tool_calls:
            assistant_text, recommended_courses = resolve_tool_calls(
                tool_calls, model_messages, req.model,
                goal=req.goal, required_skills=req.required_skills,
                conversation_id=user_id,
                course_history=req.course_history,
            )
        else:
            assistant_text = get_reply_text(result)
            recommended_courses = []

        return {"response": assistant_text, "recommended_courses": recommended_courses}, 200
    except (ValueError, ValidationError) as e:
        return jsonify({"error": str(e)}), 400
    except EnvironmentError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Chat request failed: {str(e)}"}), 500
