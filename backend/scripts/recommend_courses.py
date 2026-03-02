"""Recommend UWaterloo courses from a user prompt via skill vector search.

Example:
  poetry run python scripts/recommend_courses.py "i want to become a ui engineer"
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import typer
from bertopic import BERTopic
from sklearn.metrics.pairwise import cosine_similarity

BASE_DIR = Path(__file__).parent.parent


def load_courses(path: Path) -> list[dict]:
    with path.open() as f:
        payload = json.load(f)
    return payload["courses"]


def top_k_indices(values: np.ndarray, k: int) -> np.ndarray:
    k = min(k, len(values))
    if k <= 0:
        return np.array([], dtype=int)
    idx = np.argpartition(values, -k)[-k:]
    return idx[np.argsort(values[idx])[::-1]]


def main(
    prompt: str,
    top_skills: int = typer.Option(12, "--top-skills", min=1),
    top_courses: int = typer.Option(10, "--top-courses", min=1),
    skills_path: Path = typer.Option(
        BASE_DIR / "data/processed/skills/skills_retained_uwaterloo_cs_1261.csv",
        "--skills-path",
    ),
    skills_embeddings_path: Path = typer.Option(
        BASE_DIR / "data/processed/skills/skills_retained_embeddings_uwaterloo_cs_1261.npy",
        "--skills-embeddings-path",
    ),
    courses_path: Path = typer.Option(
        BASE_DIR / "data/raw/courses/uwaterloo_cs_courses_1261.json",
        "--courses-path",
    ),
    topic_model_path: Path = typer.Option(
        BASE_DIR / "data/processed/topics/uwaterloo_cs_courses_1261/topic_model",
        "--topic-model-path",
    ),
) -> None:
    if not skills_path.is_absolute():
        skills_path = (BASE_DIR / skills_path).resolve()
    if not skills_embeddings_path.is_absolute():
        skills_embeddings_path = (BASE_DIR / skills_embeddings_path).resolve()
    if not courses_path.is_absolute():
        courses_path = (BASE_DIR / courses_path).resolve()
    if not topic_model_path.is_absolute():
        topic_model_path = (BASE_DIR / topic_model_path).resolve()

    typer.echo("Loading data...")
    skills_df = pd.read_csv(skills_path)
    skill_embeddings = np.load(skills_embeddings_path)
    courses = load_courses(courses_path)

    if len(skills_df) != len(skill_embeddings):
        raise ValueError(
            f"skills count ({len(skills_df)}) != embedding count ({len(skill_embeddings)})"
        )

    typer.echo("Loading embedding model from BERTopic cache...")
    model = BERTopic.load(topic_model_path)

    typer.echo("Vector searching required skills...")
    prompt_emb = np.array(model.embedding_model.embed([prompt]))
    skill_scores = cosine_similarity(prompt_emb, skill_embeddings)[0]
    skill_idx = top_k_indices(skill_scores, top_skills)

    selected_skills = skills_df.iloc[skill_idx].copy()
    selected_skills["score"] = skill_scores[skill_idx]
    selected_skill_embeddings = skill_embeddings[skill_idx]

    typer.echo("\nTop required skills:")
    for _, row in selected_skills.iterrows():
        label = row.get("preferredLabel", "")
        score = row["score"]
        typer.echo(f"- {label} ({score:.3f})")

    typer.echo("\nEmbedding courses and ranking recommendations...")
    course_texts = [
        " ".join(
            filter(
                None,
                [
                    c.get("title", ""),
                    c.get("description", ""),
                    c.get("requirementsDescription", ""),
                ],
            )
        )
        for c in courses
    ]

    course_embeddings = np.array(model.embedding_model.embed(course_texts))
    course_skill_sim = cosine_similarity(course_embeddings, selected_skill_embeddings)
    course_scores = course_skill_sim.mean(axis=1)
    course_idx = top_k_indices(course_scores, top_courses)

    typer.echo("\nRecommended courses:")
    for rank, i in enumerate(course_idx, start=1):
        course = courses[i]
        title = course.get("title") or "Untitled"
        code = f"{course.get('subjectCode', '')} {course.get('catalogNumber', '')}".strip()
        score = course_scores[i]

        # Show 3 matched skills that most influenced this course score.
        match_idx_local = top_k_indices(course_skill_sim[i], 3)
        matched = [selected_skills.iloc[j]["preferredLabel"] for j in match_idx_local]

        typer.echo(f"{rank}. {code} - {title} (score={score:.3f})")
        typer.echo(f"   matched skills: {', '.join(matched)}")


if __name__ == "__main__":
    typer.run(main)
