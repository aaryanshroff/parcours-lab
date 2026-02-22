from flask import Blueprint, request, jsonify
from requests.exceptions import Timeout, ConnectionError
import requests
import os

chat_bp = Blueprint("chat", __name__)


def call_openrouter(messages: list, model: str) -> dict:
    """Send chat completion request to OpenRouter and return parsed JSON."""
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise EnvironmentError("OPENROUTER_API_KEY not configured")

    url = "https://api.openrouter.ai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=60)
    except Timeout:
        raise TimeoutError("Request to OpenRouter timed out")
    except ConnectionError:
        raise ConnectionError("Connection error when calling OpenRouter")
    except Exception as e:
        raise RuntimeError(f"Unexpected error calling OpenRouter: {str(e)}")

    try:
        result = response.json()
    except ValueError:
        raise ValueError(
            f"Invalid JSON from OpenRouter (status {response.status_code})"
        )

    if response.status_code >= 400:
        raise RuntimeError(f"OpenRouter error: {result}")

    return result


def extract_assistant_message(result: dict) -> str:
    """Extract assistant message text from OpenRouter response."""
    choices = result.get("choices")
    if not choices or not isinstance(choices, list):
        raise ValueError("Invalid OpenRouter response format (missing choices)")

    first_choice = choices[0]

    message_obj = first_choice.get("message")
    if message_obj and isinstance(message_obj, dict):
        content = message_obj.get("content")
        if content:
            return content

    if "text" in first_choice:
        return first_choice["text"]

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

    try:
        result = call_openrouter(messages, model)
        assistant_text = extract_assistant_message(result)

        return jsonify({"response": assistant_text}), 200

    except TimeoutError as e:
        return jsonify({"error": str(e)}), 504
    except ConnectionError as e:
        return jsonify({"error": str(e)}), 502
    except EnvironmentError as e:
        return jsonify({"error": str(e)}), 500
    except ValueError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        return jsonify({"error": f"Chat request failed: {str(e)}"}), 500