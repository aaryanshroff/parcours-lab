_seen_courses: dict[str, set[str]] = {}


def get_seen_course_ids(conversation_id: str) -> set[str]:
    return set(_seen_courses.get(conversation_id, set()))


def add_seen_courses(conversation_id: str, course_ids: list[str]) -> None:
    seen = _seen_courses.setdefault(conversation_id, set())
    seen.update(cid.strip() for cid in course_ids if cid and cid.strip())
