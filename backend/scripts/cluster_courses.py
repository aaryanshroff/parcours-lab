#!/usr/bin/env python3
"""Cluster courses by topic using BERTopic.

Requires LLVM installed (for llvmlite/numba dependency).
"""

import json
from pathlib import Path
from bertopic import BERTopic

DATA_PATH = Path(__file__).parent.parent / "data/courses/course_catalog_esco.json"

with open(DATA_PATH) as f:
    courses = json.load(f)["courses"]

# Combine title + description for better topic detection
texts = [f"{c['title']} {c.get('description') or ''}" for c in courses]

# Fit model
model = BERTopic(verbose=True)
topics, probs = model.fit_transform(texts)

# Show topic info
print("\n=== Topics Discovered ===\n")
topic_info = model.get_topic_info()
for _, row in topic_info.iterrows():
    if row["Topic"] == -1:
        label = "outliers"
    else:
        label = row["Name"]
    print(f"  Topic {row['Topic']:>3}: {row['Count']:>4} courses - {label}")

# Show sample courses per topic
print("\n=== Sample Courses per Topic ===\n")
for topic_id in sorted(set(topics)):
    if topic_id == -1:
        continue
    print(f"Topic {topic_id}: {model.get_topic(topic_id)[:5]}")
    indices = [i for i, t in enumerate(topics) if t == topic_id][:3]
    for i in indices:
        print(f"  - {courses[i]['title']}")
    print()
