"""Smoke test for /api/skills and /api/profile endpoints.

Expects the Flask server to be running on http://127.0.0.1:5001.

Usage:
    cd backend
    poetry run python scripts/test_skills_profile.py
"""

import json
import sys

import requests

BASE = "http://127.0.0.1:5001/api"
PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
failures = 0


def check(label: str, condition: bool, detail: str = ""):
    global failures
    status = PASS if condition else FAIL
    msg = f"  [{status}] {label}"
    if detail:
        msg += f"  ({detail})"
    print(msg)
    if not condition:
        failures += 1


# ── 1. GET /api/skills ─────────────────────────────────────────────────

print("\n── GET /api/skills ──")
r = requests.get(f"{BASE}/skills", timeout=10)
check("status 200", r.status_code == 200, f"got {r.status_code}")

skills = r.json()
check("returns a list", isinstance(skills, list))
check("non-empty", len(skills) > 0, f"{len(skills)} skills")

if skills:
    first = skills[0]
    check("has 'label' field", "label" in first, f"keys: {list(first.keys())}")
    check("has 'uri' field", "uri" in first)
    check("sorted alphabetically", skills[0]["label"].lower() <= skills[1]["label"].lower())
    print(f"  sample: {first['label']}")

# ── 2. Profile endpoints (require Supabase) ────────────────────────────

print("\n── Profile endpoints ──")

# 2a. Create a test user directly so we have a user_id to work with
print("  creating test user via Supabase...")
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv
load_dotenv()

test_user_id = None
try:
    from config.db import supabase
    if supabase is None:
        raise RuntimeError("supabase client is None")

    result = (
        supabase.table("user_profiles")
        .insert({"email": "test-skills-profile@example.com"})
        .execute()
    )
    test_user_id = result.data[0]["id"]
    print(f"  created test user: {test_user_id}")
except Exception as e:
    print(f"  \033[93mSKIP\033[0m - could not create test user: {e}")

if test_user_id:
    # 2b. GET /api/profile/<id> — initial state
    print("\n── GET /api/profile/<id> (initial) ──")
    r = requests.get(f"{BASE}/profile/{test_user_id}", timeout=10)
    check("status 200", r.status_code == 200, f"got {r.status_code}")
    body = r.json()
    check("goal is empty", body.get("goal") == "", f"goal={body.get('goal')!r}")
    check("skills is empty list", body.get("skills") == [], f"skills={body.get('skills')!r}")

    # 2c. PUT /api/profile/<id>/skills
    print("\n── PUT /api/profile/<id>/skills ──")
    skills_payload = {"skills": ["Python", "SQL", "Machine Learning"]}
    r = requests.put(f"{BASE}/profile/{test_user_id}/skills", json=skills_payload, timeout=10)
    check("status 200", r.status_code == 200, f"got {r.status_code}")
    body = r.json()
    check("returns updated skills", body.get("skills") == skills_payload["skills"],
          f"got {body.get('skills')}")

    # 2d. PUT /api/profile/<id>/goal
    print("\n── PUT /api/profile/<id>/goal ──")
    goal_payload = {"goal": "Become a machine learning engineer"}
    r = requests.put(f"{BASE}/profile/{test_user_id}/goal", json=goal_payload, timeout=10)
    check("status 200", r.status_code == 200, f"got {r.status_code}")
    body = r.json()
    check("returns updated goal", body.get("goal") == goal_payload["goal"],
          f"got {body.get('goal')!r}")

    # 2e. GET /api/profile/<id> — verify round-trip
    print("\n── GET /api/profile/<id> (after updates) ──")
    r = requests.get(f"{BASE}/profile/{test_user_id}", timeout=10)
    body = r.json()
    check("goal persisted", body.get("goal") == goal_payload["goal"])
    check("skills persisted", body.get("skills") == skills_payload["skills"])

    # 2f. Validation: bad payloads
    print("\n── Validation checks ──")
    r = requests.put(f"{BASE}/profile/{test_user_id}/skills",
                     json={"skills": "not a list"}, timeout=10)
    check("rejects non-list skills", r.status_code == 400, f"got {r.status_code}")

    r = requests.put(f"{BASE}/profile/{test_user_id}/goal",
                     json={"goal": 123}, timeout=10)
    check("rejects non-string goal", r.status_code == 400, f"got {r.status_code}")

    # 2g. 404 for unknown user
    print("\n── 404 checks ──")
    fake_id = "00000000-0000-0000-0000-000000000000"
    r = requests.get(f"{BASE}/profile/{fake_id}", timeout=10)
    check("GET unknown user → 404", r.status_code == 404, f"got {r.status_code}")

    r = requests.put(f"{BASE}/profile/{fake_id}/skills",
                     json={"skills": []}, timeout=10)
    check("PUT skills unknown user → 404", r.status_code == 404, f"got {r.status_code}")

    # Cleanup
    print("\n  cleaning up test user...")
    try:
        supabase.table("user_profiles").delete().eq("id", test_user_id).execute()
        print(f"  deleted test user {test_user_id}")
    except Exception as e:
        print(f"  warning: cleanup failed: {e}")

# ── Summary ─────────────────────────────────────────────────────────────

print("\n" + "─" * 40)
if failures:
    print(f"\033[91m{failures} check(s) failed\033[0m")
    sys.exit(1)
else:
    print("\033[92mAll checks passed!\033[0m")
