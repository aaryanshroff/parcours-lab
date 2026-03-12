from flask import Blueprint, jsonify
from config.db import supabase
from utils import validate_request_body
from schemas.courses import CourseActionRequest

courses_bp = Blueprint("courses", __name__)

@courses_bp.route("/courses", methods=["POST"])
@validate_request_body(CourseActionRequest)
def handle_course(payload: CourseActionRequest):

    decision = "keep" if payload.status == "accepted" else "reject"

    response = supabase.table("course_history").insert({
        "user_id": payload.user_id,
        "course_id": payload.course_id,
        "decision": decision
    }).execute()

    return jsonify(response.data)