"""Search through filtered skills using semantic similarity."""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

# Constants
BASE_DIR = Path(__file__).parent.parent
SKILLS_PATH = BASE_DIR / "data/processed/skills/skills_retained.csv"
EMBEDDINGS_PATH = BASE_DIR / "data/processed/skills/skills_retained_embeddings.npy"
MODEL_NAME = "all-MiniLM-L6-v2"


def search_skills(query: str, top_n: int = 10):
    if not SKILLS_PATH.exists() or not EMBEDDINGS_PATH.exists():
        print(f"Error: Processed data not found. Please run filter_skills.py first.")
        print(f"Expected: {SKILLS_PATH}")
        sys.exit(1)

    # Load data
    df = pd.read_csv(SKILLS_PATH)
    skill_embeddings = np.load(EMBEDDINGS_PATH)

    # Load model and embed query
    model = SentenceTransformer(MODEL_NAME)
    query_embedding = model.encode([query])

    # Calculate similarity
    similarities = cosine_similarity(query_embedding, skill_embeddings)[0]

    # Get top results
    top_indices = np.argsort(similarities)[::-1][:top_n]

    print(f"\nTop {top_n} matches for: '{query}'\n")
    print(f"{'Score':<8} | {'Skill Label'}")
    print("-" * 50)

    for idx in top_indices:
        score = similarities[idx]
        label = df.iloc[idx]["preferredLabel"]
        print(f"{score:.4f} | {label}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python search_skills.py <search_query>")
        sys.exit(1)

    query = " ".join(sys.argv[1:])
    search_skills(query)
