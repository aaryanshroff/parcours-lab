import os
from dotenv import load_dotenv

from app import app


def main() -> None:
    load_dotenv()

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("❌ OPENROUTER_API_KEY not set in environment")
        return

    payload = {
        "model": "minimax/minimax-m2",
        "messages": [
            {"role": "system", "content": "You are a concise assistant."},
            {"role": "user", "content": "Reply with exactly: CHAT_OK"},
        ],
    }

    print("=== chat.py End-to-End Test (/api/chat) ===")

    client = app.test_client()
    response = client.post("/api/chat", json=payload)

    print(f"Status: {response.status_code}")

    body = response.get_json(silent=True)
    if body is None:
        print("Body (raw):", response.get_data(as_text=True))
        return

    print("Body (json):", body)
    print("Response field:", body.get("response"))

    if response.status_code == 200 and isinstance(body.get("response"), str) and body.get("response").strip():
        print("✅ chat.py route + model call succeeded")
    else:
        print("❌ chat.py test failed (unexpected status or response payload)")


if __name__ == "__main__":
    main()