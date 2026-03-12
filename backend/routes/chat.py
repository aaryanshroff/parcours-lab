from flask import Blueprint, request, jsonify
from pydantic import ValidationError
from schemas.chat import ChatRequest
from services.llm import call_openrouter, get_reply_text, extract_tool_calls
from services.tools import TOOLS, build_system_prompt, resolve_tool_calls

chat_bp = Blueprint("chat", __name__)


@chat_bp.route("/chat", methods=["POST"])
def chat():
    """Accept chat messages and return assistant response."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid request body"}), 400

    try:
        req = ChatRequest.model_validate(data)

        system_prompt = build_system_prompt(
            goal=req.goal,
            current_skills=req.current_skills,
            required_skills=req.required_skills,
        )

        model_messages: list[dict[str, object]] = [
            {"role": "system", "content": system_prompt},
            *req.to_openrouter_messages(),
        ]

        result = call_openrouter(model_messages, model=req.model, tools=TOOLS, tool_choice="auto")
        tool_calls = extract_tool_calls(result)

        if tool_calls:
            assistant_text, recommended_courses, profile_updates = resolve_tool_calls(
                tool_calls, model_messages, req.model,
                goal=req.goal,
                current_skills=req.current_skills,
                required_skills=req.required_skills,
            )
        else:
            assistant_text = get_reply_text(result)
            recommended_courses = []
            profile_updates = None

        response_body: dict[str, object] = {
            "response": assistant_text,
            "recommended_courses": recommended_courses,
        }
        if profile_updates:
            response_body["profile_updates"] = profile_updates

        return response_body, 200
    except (ValueError, ValidationError) as e:
        return jsonify({"error": str(e)}), 400
    except EnvironmentError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"Chat request failed: {str(e)}"}), 500
