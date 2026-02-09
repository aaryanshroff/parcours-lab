from flask import Blueprint, request

profile_bp = Blueprint("profile", __name__)


@profile_bp.route("/profile", methods=["POST"])
def build_profile():
    """Accept a bio and return a structured profile with ESCO skill matches."""
    raise NotImplementedError
