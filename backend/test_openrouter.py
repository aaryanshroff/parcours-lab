import os
from dotenv import load_dotenv
import requests

load_dotenv()  # <-- load .env

# forced DNS
FORCED_IP = "34.199.168.153"
api_host = "api.openrouter.ai"
api_url = f"https://{FORCED_IP}/v1/chat/completions"

api_key = os.environ.get("OPENROUTER_API_KEY")

print("=== OpenRouter Connectivity Test with Forced DNS ===\n")

if not api_key:
    print("❌ OPENROUTER_API_KEY not set in environment")
else:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Host": api_host
    }
    payload = {
        "model": "minimax/minimax-m2",
        "messages": [{"role": "user", "content": "Say hello in one sentence."}]
    }

    try:
        resp = requests.post(api_url, headers=headers, json=payload, timeout=15)
        print(f"✅ HTTP request successful: status {resp.status_code}")
        try:
            print("Response JSON:", resp.json())
        except Exception:
            print("Response text:", resp.text)
    except requests.exceptions.RequestException as e:
        print(f"❌ HTTP request failed: {e}")