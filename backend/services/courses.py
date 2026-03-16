from pydantic import BaseModel
from pathlib import Path
from functools import lru_cache
import json
import numpy as np

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
    format: str = ""
    duration_hours: int | None = None
    price: str = ""
    rating: float | None = None
    certificate: bool = False
    skills: list[dict[str, str]] = []

    @classmethod
    def from_raw(cls, course: dict, fallback_index: int) -> "CoursePayload":
        desc = str(
            course.get("description") or course.get("descriptionAbbreviated") or ""
        ).strip()
        skills = []
        for skill in course.get("skills", []):
            if isinstance(skill, dict):
                skills.append({
                    "name": str(skill.get("name", "")),
                    "esco_uri": str(skill.get("esco_uri", "")),
                    "description": str(skill.get("description", "")),
                })
        duration = course.get("duration_hours")
        return cls(
            id=str(course.get("id") or f"course-{fallback_index}"),
            title=str(course.get("title") or "Untitled course").strip(),
            provider=str(course.get("provider") or "").strip(),
            url=str(course.get("url") or "").strip(),
            summary=(desc[:280] + "...") if len(desc) > 280 else desc,
            level=str(course.get("level") or "").strip(),
            language=str(course.get("language") or "").strip(),
            format=str(course.get("format") or "").strip(),
            duration_hours=int(duration) if duration else None,
            price=str(course.get("price") or "").strip(),
            rating=course.get("rating"),
            certificate=bool(course.get("certificate", False)),
            skills=skills,
        )


@lru_cache(maxsize=1)
def load_course_catalog() -> list[dict[str, object]]:
    with COURSE_CATALOG_PATH.open(encoding="utf-8") as f:
        payload = json.load(f)

    courses = payload.get("courses", [])
    if not isinstance(courses, list):
        raise ValueError("Invalid courses catalog format")
    return courses


def _build_course_texts(courses: list[dict]) -> list[str]:
    """Concatenate title + description for embedding."""
    return [
        " ".join(
            filter(None, [str(c.get("title", "")), str(c.get("description", ""))])
        )
        for c in courses
    ]


# Pre-compute course embeddings at startup
from services.skill_matcher import _topic_model  # noqa: E402

_courses_raw = load_course_catalog()
_course_texts = _build_course_texts(_courses_raw)
_course_embeddings = np.array(_topic_model.embedding_model.embed(_course_texts)).astype(np.float32)
_course_norms = np.linalg.norm(_course_embeddings, axis=1, keepdims=True)
_course_embeddings_normed = _course_embeddings / np.where(_course_norms == 0, 1, _course_norms)


def get_recommended_courses(
    goal: str,
    required_skills: list[str],
    count: int = 3,
    exclude_course_ids: set[str] | None = None,
) -> list[dict[str, str]]:
    """Rank courses by semantic similarity to the goal + required skills."""
    queries = [q for q in [goal, *required_skills] if q and q.strip()]
    if not queries:
        return []

    query_embs = np.array(_topic_model.embedding_model.embed(queries)).astype(np.float32)
    query_norms = np.linalg.norm(query_embs, axis=1, keepdims=True)
    query_embs_normed = query_embs / np.where(query_norms == 0, 1, query_norms)

    # Average cosine similarity of each course against all query embeddings
    sim_matrix = _course_embeddings_normed @ query_embs_normed.T  # (n_courses, n_queries)
    scores = sim_matrix.mean(axis=1)

    excluded = exclude_course_ids or set()
    ranked_idx = np.argsort(scores)[::-1]
    results: list[dict[str, str]] = []

    for idx in ranked_idx:
        payload = CoursePayload.from_raw(_courses_raw[int(idx)], int(idx))
        if payload.id in excluded:
            continue
        results.append(payload.model_dump())
        if len(results) >= count:
            break

    return results


@lru_cache(maxsize=1)
def _course_payload_map() -> dict[str, dict[str, object]]:
    courses = load_course_catalog()
    mapping: dict[str, dict[str, object]] = {}
    for idx, course in enumerate(courses):
        payload = CoursePayload.from_raw(course, idx).model_dump()
        mapping[str(payload.get("id"))] = payload
    return mapping


def get_courses_by_ids(course_ids: list[str]) -> dict[str, dict[str, object]]:
    lookup = _course_payload_map()
    return {cid: lookup.get(cid) for cid in course_ids}
