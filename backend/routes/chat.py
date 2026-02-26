from openrouter.components.chatresponse import ChatResponse
from openrouter import OpenRouter
from flask import Blueprint, request, jsonify
from requests.exceptions import Timeout, ConnectionError
import requests
import os

chat_bp = Blueprint("chat", __name__)


def call_openrouter(messages: list, model: str = "minimax/minimax-m2") -> dict:
    """Send chat completion request to OpenRouter and return parsed JSON."""
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise EnvironmentError("OPENROUTER_API_KEY not configured")

    with OpenRouter(
        api_key=api_key
    ) as client:
        result = client.chat.send(
            model=model,
            messages=messages
        )

    return result


def extract_assistant_message(result: ChatResponse) -> str:
    """Extract assistant message text from OpenRouter response."""

    choices = result.choices
    if not choices or not isinstance(choices, list):
        raise ValueError("Invalid OpenRouter response format (missing choices)")

    first_choice = choices[0]

    message_obj = first_choice.message
    if message_obj:
        content = message_obj.content
        if content:
            return content

    if "text" in first_choice:
        return first_choice.text

    raise ValueError("Could not extract assistant response")

# -----------------------------
# Route
# -----------------------------
@chat_bp.route("/chat", methods=["POST"])
def chat():
    """Accept chat messages and return assistant response."""
    data = request.get_json(silent=True)

    if not data or "messages" not in data:
        return jsonify({"error": "Missing 'messages' field"}), 400

    messages = data["messages"]
    model = data.get("model", "minimax/minimax-m2")

    if not isinstance(messages, list) or not all(
        isinstance(m, dict) and "role" in m and "content" in m
        for m in messages
    ):
        return jsonify(
            {"error": "'messages' must be a list of {role, content} objects"}
        ), 400

    result = call_openrouter(messages, model)
    assistant_text = extract_assistant_message(result)

    return {"response": assistant_text}, 200
        
