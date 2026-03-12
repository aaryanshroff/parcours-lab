from flask import Blueprint, request, jsonify
from config.db import supabase

courses_bp = Blueprint("courses", __name__)

@courses_bp.route("/courses/accept", methods=["POST"])
def accept_course():
    data = request.json

    user_id = data.get("user_id")
    course_id = data.get("course_id")

    response = supabase.table("course_history").insert({
        "user_id": user_id,
        "course_id": course_id,
        "decision": "keep"
    }).execute()

    return jsonify(response.data)

@courses_bp.route("/courses/reject", methods=["POST"])
def reject_course():
    data = request.json

    user_id = data.get("user_id")
    course_id = data.get("course_id")

    response = supabase.table("course_history").insert({
        "user_id": user_id,
        "course_id": course_id,
        "decision": "reject"
    }).execute()

    return jsonify(response.data)


