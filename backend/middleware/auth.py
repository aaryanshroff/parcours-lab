from functools import wraps

from flask import g, jsonify, request

from config.db import supabase


def require_auth(f):
    """Decorator that verifies the Supabase access token from the Authorization header."""

    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401

        token = auth_header.removeprefix("Bearer ")

        try:
            user_response = supabase.auth.get_user(token)
            g.user = user_response.user
        except Exception:
            return jsonify({"error": "Invalid or expired token"}), 401

        return f(*args, **kwargs)

    return decorated
