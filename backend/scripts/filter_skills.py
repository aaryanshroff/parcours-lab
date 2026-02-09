"""Filter skills using semantic similarity to course topics and ESCO code filters."""

import json
import logging
import pickle
import tomllib
from pathlib import Path

import numpy as np
import pandas as pd
from bertopic import BERTopic
from sklearn.metrics.pairwise import cosine_similarity

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent
CONFIG_PATH = Path(__file__).parent / "filter_skills_config.toml"


def load_config(path: Path) -> dict:
    with open(path, "rb") as f:
        return tomllib.load(f)


def load_courses(path: Path) -> list[dict]:
    with open(path) as f:
        return json.load(f)["courses"]


def get_or_create_topics(courses: list[dict], cache_dir: Path) -> tuple[BERTopic, np.ndarray]:
    """Load topic model and embeddings from cache, or create and cache them."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    model_path = cache_dir / "topic_model"
    embeddings_path = cache_dir / "topic_embeddings.npy"

    # Load from cache if available
    if model_path.exists() and embeddings_path.exists():
        logger.info("Loading cached topic model...")
        model = BERTopic.load(model_path)
        embeddings = np.load(embeddings_path)
        return model, embeddings

    # Create new model
    logger.info("Discovering topics (this may take a while)...")
    texts = [f"{c['title']} {c.get('description', '')}" for c in courses]
    model = BERTopic(verbose=False)
    model.fit_transform(texts)

    embeddings = model.topic_embeddings_
    if model.topic_labels_[0] == -1:
        embeddings = embeddings[1:]

    # Cache for next run
    model.save(model_path, serialization="safetensors", save_ctfidf=True)
    np.save(embeddings_path, embeddings)
    logger.info(f"Cached topic model to {cache_dir}")

    return model, embeddings


def load_skills_with_codes(skills_path: Path, broader_path: Path, groups_path: Path) -> pd.DataFrame:
    """Load skills and map them to their hierarchy codes via broader relations."""
    skills_df = pd.read_csv(skills_path)
    broader_df = pd.read_csv(broader_path)
    groups_df = pd.read_csv(groups_path)

    uri_to_code = dict(zip(groups_df["conceptUri"], groups_df["code"]))

    skill_to_parent = dict(
        zip(broader_df["conceptUri"], broader_df["broaderUri"]))

    def get_code(uri: str, max_hops: int = 5) -> str:
        for _ in range(max_hops):
            if uri in uri_to_code and pd.notna(uri_to_code[uri]):
                return str(uri_to_code[uri])
            if uri not in skill_to_parent:
                break
            uri = skill_to_parent[uri]
        return ""

    skills_df["code"] = skills_df["conceptUri"].apply(get_code)
    return skills_df


def embed_skills(df: pd.DataFrame, model: BERTopic) -> list:
    """Embeds skills using the topic model's internal embedding model."""
    texts = (df["preferredLabel"].fillna("") + " " +
             df["altLabels"].fillna("") + " " +
             df["description"].fillna("")).str.strip()
    return model.embedding_model.embed(texts.tolist())


def filter_by_similarity(df: pd.DataFrame, skill_emb: list, topic_emb: list, threshold: float) -> pd.DataFrame:
    similarity = cosine_similarity(skill_emb, topic_emb)
    max_sim = similarity.max(axis=1)
    df = df.copy()
    df["courseTopicSimilarity"] = max_sim

    is_javanese = df["preferredLabel"].str.contains(
        "javanese", case=False, na=False)

    return df[(max_sim >= threshold) | is_javanese]


def apply_exclusions(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    prefixes = config.get("exclude_prefixes", [])
    if not prefixes:
        return df

    pattern = "|".join(f"^{p}" for p in prefixes)
    mask = ~df["code"].str.match(pattern, na=False)
    excluded = len(df) - mask.sum()
    df = df[mask]
    logger.info(f"Excluded {excluded} skills by code prefix")
    return df


def main():
    config = load_config(CONFIG_PATH)
    threshold = config.get("topic_similarity_threshold", 0.5)

    courses_path = BASE_DIR / "data/raw/courses/course_catalog_esco.json"
    skills_path = BASE_DIR / "data/raw/skills/skills_en.csv"
    broader_path = BASE_DIR / "data/raw/skills/broaderRelationsSkillPillar_en.csv"
    groups_path = BASE_DIR / "data/raw/skills/skillGroups_en.csv"
    output_path = BASE_DIR / "data/processed/skills/skills_retained.csv"
    topics_cache_dir = BASE_DIR / "data/processed/topics"

    courses = load_courses(courses_path)
    model, topic_embeddings = get_or_create_topics(courses, topics_cache_dir)
    logger.info(
        f"Using {len(topic_embeddings)} topics from {len(courses)} courses")

    logger.info("Loading skills with hierarchy codes...")
    skills_df = load_skills_with_codes(skills_path, broader_path, groups_path)

    logger.info("Applying exclusions...")
    skills_df = apply_exclusions(skills_df, config)

    logger.info("Embedding skills...")
    skill_embeddings = embed_skills(skills_df, model)

    logger.info("Filtering by semantic similarity...")
    filtered_df = filter_by_similarity(
        skills_df, skill_embeddings, topic_embeddings, threshold)
    excluded_df = skills_df[~skills_df["conceptUri"].isin(
        filtered_df["conceptUri"])]
    logger.info(
        f"Retained {len(filtered_df)}/{len(skills_df)} skills (threshold={threshold})")

    # Save to CSV
    output_path.parent.mkdir(parents=True, exist_ok=True)
    filtered_df.to_csv(output_path, index=False)

    # Save embeddings of retained skills for search
    retained_embeddings = np.array(skill_embeddings)[
        skills_df.index.isin(filtered_df.index)]
    embeddings_output_path = output_path.with_name(
        "skills_retained_embeddings.npy")
    np.save(embeddings_output_path, retained_embeddings)

    excluded_path = output_path.with_name("skills_excluded.csv")
    excluded_df.to_csv(excluded_path, index=False)
    logger.info(f"Saved {len(filtered_df)} retained: {output_path}")
    logger.info(f"Saved embeddings: {embeddings_output_path}")
    logger.info(f"Saved {len(excluded_df)} excluded: {excluded_path}")

    # Log samples
    logger.info("\n=== SAMPLE RETAINED ===")
    for s in filtered_df["preferredLabel"].sample(min(10, len(filtered_df))).tolist():
        logger.info(f"  + {s}")
    logger.info("\n=== SAMPLE EXCLUDED ===")
    for s in excluded_df["preferredLabel"].sample(min(10, len(excluded_df))).tolist():
        logger.info(f"  - {s}")


if __name__ == "__main__":
    main()
