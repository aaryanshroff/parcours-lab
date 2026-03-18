from functools import wraps

from flask import g, jsonify, request

from config.db import supabase


def _extract_user():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header.removeprefix("Bearer ")
    try:
        return supabase.auth.get_user(token).user
    except Exception:
        return None


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        g.user = _extract_user()
        if not g.user:
            return jsonify({"error": "Missing or invalid Authorization header"}), 401
        return f(*args, **kwargs)
    return decorated


def optional_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        g.user = _extract_user()
        return f(*args, **kwargs)
    return decorated
