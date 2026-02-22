"""Filter skills using semantic similarity to course topics and ESCO code filters."""

import time
import json
import logging
import tomllib
from pathlib import Path

import numpy as np
import pandas as pd
import typer
from bertopic import BERTopic
from bertopic.representation import KeyBERTInspired
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from tqdm import tqdm

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


def get_or_create_topics(
    courses: list[dict], cache_dir: Path, reduce_outliers: bool = True
) -> tuple[BERTopic, np.ndarray]:
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
    logger.info(f"Prepared {len(texts)} course texts for topic modeling")
    vectorizer_model = CountVectorizer(
        stop_words="english",
        ngram_range=(1, 2),
        min_df=2,
    )
    representation_model = KeyBERTInspired()
    model = BERTopic(
        verbose=True,
        vectorizer_model=vectorizer_model,
        representation_model=representation_model,
        min_topic_size=5,
    )
    topics, _ = model.fit_transform(texts)

    if reduce_outliers and any(t == -1 for t in topics):
        logger.info("Reducing outliers for cleaner topics...")
        topics = model.reduce_outliers(texts, topics, strategy="embeddings")
        model.update_topics(texts, topics=topics)
    logger.info("Topic modeling complete")

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


def embed_skills(df: pd.DataFrame, model: BERTopic, batch_size: int = 256) -> np.ndarray:
    """Embed skills in batches so long runs show progress."""
    texts = (df["preferredLabel"].fillna("") + " " +
             df["altLabels"].fillna("") + " " +
             df["description"].fillna("")).str.strip()
    texts_list = texts.tolist()
    total = len(texts_list)
    if total == 0:
        return np.empty((0, 0))

    logger.info(f"Embedding {total} skills in batches of {batch_size}...")
    embeddings_batches = []
    for start in tqdm(
        range(0, total, batch_size),
        desc="Embedding skills",
        unit="batch",
        leave=False,
    ):
        end = min(start + batch_size, total)
        batch_embeddings = model.embedding_model.embed(texts_list[start:end])
        embeddings_batches.append(np.array(batch_embeddings))

    logger.info("Skill embedding complete")
    return np.vstack(embeddings_batches)


def filter_by_similarity(
    df: pd.DataFrame, skill_emb: np.ndarray, topic_emb: np.ndarray, threshold: float
) -> pd.DataFrame:
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


def main(
    courses_path: Path = typer.Option(
        BASE_DIR / "data/raw/courses/course_catalog_esco.json",
        "--courses-path",
        help="Path to a JSON file with top-level key 'courses'.",
    ),
    topics_cache_dir: Path | None = typer.Option(
        None,
        "--topics-cache-dir",
        help="Optional cache directory for topic model/embeddings. Defaults to data/processed/topics/<courses-file-stem>/",
    ),
    output_prefix: str | None = typer.Option(
        None,
        "--output-prefix",
        help="Optional output prefix for separate files. Example: 'uwaterloo_cs_1261' writes skills_retained_uwaterloo_cs_1261.csv and related files.",
    ),
    reduce_outliers: bool = typer.Option(
        True,
        "--reduce-outliers/--no-reduce-outliers",
        help="Reduce BERTopic outlier cluster (-1) for cleaner topic labels.",
    ),
) -> None:
    start_time = time.time()
    logger.info("Starting skill filtering...")
    logger.info("Loading dependencies...")
    logger.info(f"Using courses file: {courses_path}")
    config = load_config(CONFIG_PATH)
    threshold = config.get("topic_similarity_threshold", 0.5)

    if not courses_path.is_absolute():
        courses_path = (BASE_DIR / courses_path).resolve()

    skills_path = BASE_DIR / "data/raw/skills/skills_en.csv"
    broader_path = BASE_DIR / "data/raw/skills/broaderRelationsSkillPillar_en.csv"
    groups_path = BASE_DIR / "data/raw/skills/skillGroups_en.csv"
    output_dir = BASE_DIR / "data/processed/skills"
    if output_prefix:
        output_path = output_dir / f"skills_retained_{output_prefix}.csv"
    else:
        output_path = output_dir / "skills_retained.csv"
    if topics_cache_dir:
        if not topics_cache_dir.is_absolute():
            topics_cache_dir = (BASE_DIR / topics_cache_dir).resolve()
    else:
        # Keep per-course-source cache to avoid accidentally reusing topics from another dataset.
        topics_cache_dir = BASE_DIR / "data/processed/topics" / courses_path.stem

    courses = load_courses(courses_path)
    logger.info(f"Loaded {len(courses)} courses from {courses_path}")
    model, topic_embeddings = get_or_create_topics(
        courses, topics_cache_dir, reduce_outliers=reduce_outliers
    )
    logger.info(
        f"Using {len(topic_embeddings)} topics from {len(courses)} courses",
    )

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
        f"Retained {len(filtered_df)}/{len(skills_df)} skills (threshold={threshold})",
    )

    # Save to CSV
    output_path.parent.mkdir(parents=True, exist_ok=True)
    filtered_df.to_csv(output_path, index=False)

    # Save embeddings of retained skills for search
    retained_embeddings = np.array(skill_embeddings)[
        skills_df.index.isin(filtered_df.index)]
    if output_prefix:
        embeddings_output_path = output_path.with_name(
            f"skills_retained_embeddings_{output_prefix}.npy")
    else:
        embeddings_output_path = output_path.with_name(
            "skills_retained_embeddings.npy")
    np.save(embeddings_output_path, retained_embeddings)

    if output_prefix:
        excluded_path = output_path.with_name(
            f"skills_excluded_{output_prefix}.csv")
    else:
        excluded_path = output_path.with_name("skills_excluded.csv")
    excluded_df.to_csv(excluded_path, index=False)
    logger.info(f"Saved {len(filtered_df)} retained: {output_path}")
    logger.info(f"Saved embeddings: {embeddings_output_path}")
    logger.info(f"Saved {len(excluded_df)} excluded: {excluded_path}")
    logger.info(f"Done in {time.time() - start_time:.1f}s")

    # Log samples
    logger.info("\n=== SAMPLE RETAINED ===")
    for s in filtered_df["preferredLabel"].sample(min(10, len(filtered_df))).tolist():
        logger.info(f"  + {s}")
    logger.info("\n=== SAMPLE EXCLUDED ===")
    for s in excluded_df["preferredLabel"].sample(min(10, len(excluded_df))).tolist():
        logger.info(f"  - {s}")


if __name__ == "__main__":
    typer.run(main)
