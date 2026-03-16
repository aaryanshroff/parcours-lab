import json
from typing import Iterable

from config.db import supabase
from services.courses import get_courses_by_ids


def _parse_feedback(raw: object) -> dict:
    if isinstance(raw, str) and raw.strip():
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return {}


def load_course_history(user_id: str) -> list[dict[str, object]]:
    result = (
        supabase.table("course_history")
        .select("course_id, decision, feedback")
        .eq("user_id", user_id)
        .execute()
    )
    rows = result.data if (result and result.data) else []
    if not rows:
        return []

    course_ids = [row.get("course_id") for row in rows if row.get("course_id")]
    course_map = get_courses_by_ids(course_ids)

    merged: dict[str, dict[str, object]] = {}
    for row in rows:
        course_id = row.get("course_id")
        if not course_id:
            continue

        feedback = _parse_feedback(row.get("feedback") or "")
        payload = course_map.get(course_id) or {
            "id": course_id,
            "title": str(feedback.get("title") or "Untitled course"),
        }

        decision = row.get("decision") or "keep"
        status = "rejected" if decision == "reject" else "accepted"

        merged[course_id] = {
            **payload,
            "status": status,
            "progress": feedback.get("progress"),
            "done": feedback.get("done"),
            "rejection_reason": feedback.get("rejection_reason"),
        }

    return list(merged.values())


def save_course_history(user_id: str, courses: Iterable[dict[str, object]]) -> None:
    supabase.table("course_history").delete().eq("user_id", user_id).execute()

    rows = []
    for course in courses:
        course_id = str(course.get("id") or "").strip()
        if not course_id:
            continue

        status = str(course.get("status") or "")
        decision = "reject" if status == "rejected" else "keep"
        feedback = json.dumps({
            "title": course.get("title"),
            "provider": course.get("provider"),
            "url": course.get("url"),
            "summary": course.get("summary"),
            "level": course.get("level"),
            "format": course.get("format"),
            "duration_hours": course.get("duration_hours"),
            "price": course.get("price"),
            "rating": course.get("rating"),
            "certificate": course.get("certificate"),
            "skills": course.get("skills"),
            "rejection_reason": course.get("rejection_reason"),
            "progress": course.get("progress"),
            "done": course.get("done"),
        })
        rows.append({
            "user_id": user_id,
            "course_id": course_id,
            "decision": decision,
            "feedback": feedback,
        })

    if rows:
        supabase.table("course_history").insert(rows).execute()
