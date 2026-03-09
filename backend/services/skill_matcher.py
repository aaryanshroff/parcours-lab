"""Semantic skill matching against pre-computed ESCO skill embeddings.

Module-level loading: CSV, embeddings, and BERTopic model are loaded once on
import (i.e. when Flask starts), so all requests hit a warm cache.
"""

import numpy as np
import pandas as pd
from bertopic import BERTopic
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
SKILLS_CSV_PATH = BASE_DIR / "data/processed/skills/skills_retained.csv"
SKILLS_EMBEDDINGS_PATH = BASE_DIR / "data/processed/skills/skills_retained_embeddings.npy"
TOPIC_MODEL_PATH = BASE_DIR / "data/processed/topics/topic_model"

# Loaded once at startup
_skills_df = pd.read_csv(SKILLS_CSV_PATH)
_skill_embeddings = np.load(SKILLS_EMBEDDINGS_PATH).astype(np.float32)
_topic_model = BERTopic.load(TOPIC_MODEL_PATH)

# Normalize pre-computed embeddings once for fast cosine via dot product
_norms = np.linalg.norm(_skill_embeddings, axis=1, keepdims=True)
_skill_embeddings_normed = _skill_embeddings / np.where(_norms == 0, 1, _norms)


def match_skills(query: str, top_k: int = 10, threshold: float = 0.4) -> list[dict]:
    """Embed query text and return top-k ESCO skills above the similarity threshold."""
    if not query or not query.strip():
        return []

    query_emb = np.array(_topic_model.embedding_model.embed([query]))[0]
    query_emb = query_emb / (np.linalg.norm(query_emb) or 1.0)
    scores = _skill_embeddings_normed @ query_emb

    # Filter by threshold, then take top-k
    mask = scores >= threshold
    if not mask.any():
        return []

    indices = np.where(mask)[0]
    masked_scores = scores[indices]

    # Sort descending, take top-k
    k = min(top_k, len(indices))
    top_idx = np.argpartition(masked_scores, -k)[-k:]
    top_idx = top_idx[np.argsort(masked_scores[top_idx])[::-1]]

    results = []
    for i in top_idx:
        row = _skills_df.iloc[indices[i]]
        results.append({
            "label": row["preferredLabel"],
            "uri": row["conceptUri"],
            "score": round(float(masked_scores[i]), 3),
        })

    return results
