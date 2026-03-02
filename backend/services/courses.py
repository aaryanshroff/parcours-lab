from pydantic import BaseModel
from pathlib import Path
from functools import lru_cache
import random
import json

BASE_DIR = Path(__file__).parent.parent
COURSE_CATALOG_PATH = BASE_DIR / "data/raw/courses/course_catalog_esco.json"


class CoursePayload(BaseModel):
    id: str
    title: str = ""
    provider: str = ""
    url: str = ""
    summary: str = ""
    level: str = ""
    language: str = ""

    @classmethod
    def from_raw(cls, course: dict, fallback_index: int) -> "CoursePayload":
        desc = str(
            course.get("description") or course.get("descriptionAbbreviated") or ""
        ).strip()
        return cls(
            id=str(course.get("id") or f"course-{fallback_index}"),
            title=str(course.get("title") or "Untitled course").strip(),
            provider=str(course.get("provider") or "").strip(),
            url=str(course.get("url") or "").strip(),
            summary=(desc[:280] + "...") if len(desc) > 280 else desc,
            level=str(course.get("level") or "").strip(),
            language=str(course.get("language") or "").strip(),
        )


@lru_cache(maxsize=1)
def load_course_catalog() -> list[dict[str, object]]:
    with COURSE_CATALOG_PATH.open() as f:
        payload = json.load(f)

    courses = payload.get("courses", [])
    if not isinstance(courses, list):
        raise ValueError("Invalid courses catalog format")
    return courses


def get_random_recommended_courses(count: int = 3) -> list[dict[str, str]]:
    courses = load_course_catalog()
    if not courses:
        return []

    sampled = random.sample(courses, min(count, len(courses)))
    return [
        CoursePayload.from_raw(c, i).model_dump()
        for i, c in enumerate(sampled, start=1)
    ]
