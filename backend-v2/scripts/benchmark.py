#!/usr/bin/env python3
"""Benchmark generate_academic_graph across different LLM models.

Usage:
    poetry run python scripts/benchmark.py
    poetry run python scripts/benchmark.py --pid SJPJkCAih
    poetry run python scripts/benchmark.py --runs 3
    poetry run python scripts/benchmark.py --models openai/gpt-4.1-mini google/gemini-2.5-flash
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from pathlib import Path

# Allow imports from the backend-v2 package root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

from academic_graph import generate_academic_graph
from uwaterloo import get_program

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("benchmark")

DEFAULT_PID = "SJPJkCAih"  # CS Honours (20 groups)
DEFAULT_GOAL = "become a software engineer"
DEFAULT_MODELS = ["openai/gpt-4.1-mini", "google/gemini-2.5-flash"]


def run_benchmark(pid: str, goal: str, models: list[str], runs: int) -> None:
    program = get_program(pid)
    if not program:
        logger.error("Program %s not found", pid)
        sys.exit(1)

    requirement_groups = program.get("requirementGroups", [])
    major_title = program.get("title", "")
    api_key = os.environ["OPENROUTER_API_KEY"]

    logger.info("=" * 70)
    logger.info("Benchmark: %s (%d groups)", major_title, len(requirement_groups))
    logger.info("Goal: %s", goal)
    logger.info("Runs per model: %d", runs)
    logger.info("=" * 70)

    results: dict[str, list[dict]] = {}

    for model in models:
        results[model] = []
        for run_idx in range(runs):
            logger.info("\n--- %s (run %d/%d) ---", model, run_idx + 1, runs)

            # Capture timing logs
            timing: dict[str, float] = {}
            prev_elapsed = 0.0

            class TimingFilter(logging.Filter):
                def filter(self, record):
                    nonlocal prev_elapsed
                    msg = record.getMessage()
                    m = re.search(r"\[timing\]\s+(.+?)\s+—\s+([\d.]+)s", msg)
                    if m:
                        label = m.group(1)
                        elapsed = float(m.group(2))
                        timing[label] = elapsed - prev_elapsed
                        prev_elapsed = elapsed
                    return True

            filt = TimingFilter()
            logging.getLogger("academic_graph").addFilter(filt)

            t0 = time.perf_counter()
            result = generate_academic_graph(
                requirement_groups=requirement_groups,
                specialization_pids=[],
                minor_pids=[],
                goal=goal,
                api_key=api_key,
                model=model,
                elective_model=model,
                major_title=major_title,
            )
            wall_time = time.perf_counter() - t0

            logging.getLogger("academic_graph").removeFilter(filt)

            elective_codes = sorted(
                n.labels[0] for n in result.nodes
                if n.course and n.course.reason != "Required course"
            )
            term_map = {n.labels[0]: n.term for n in result.nodes if n.term}

            run_data = {
                "wall_time": wall_time,
                "timing": dict(timing),
                "nodes": len(result.nodes),
                "edges": len(result.edges),
                "electives": elective_codes,
                "terms": term_map,
            }
            results[model].append(run_data)

            logger.info("  Wall time: %.2fs", wall_time)
            for label, delta in timing.items():
                logger.info("    %s: %.2fs", label, delta)

    # ── Summary ──
    logger.info("\n" + "=" * 70)
    logger.info("SUMMARY")
    logger.info("=" * 70)

    for model in models:
        avg_wall = sum(r["wall_time"] for r in results[model]) / len(results[model])
        logger.info("\n%s (avg over %d runs)", model, runs)
        logger.info("  Avg wall time: %.2fs", avg_wall)
        logger.info("  Nodes: %d | Edges: %d", results[model][0]["nodes"], results[model][0]["edges"])
        logger.info("  Electives: %s", ", ".join(results[model][0]["electives"]))

        # Per-step averages
        all_steps = set()
        for r in results[model]:
            all_steps.update(r["timing"].keys())
        if all_steps:
            logger.info("  Per-step avg:")
            for step in sorted(all_steps):
                vals = [r["timing"].get(step, 0) for r in results[model]]
                logger.info("    %s: %.2fs", step, sum(vals) / len(vals))

    # ── Diff ──
    if len(models) == 2:
        a_electives = set(results[models[0]][0]["electives"])
        b_electives = set(results[models[1]][0]["electives"])
        only_a = a_electives - b_electives
        only_b = b_electives - a_electives
        common = a_electives & b_electives

        logger.info("\n--- Elective Diff ---")
        logger.info("  Common: %d/%d", len(common), max(len(a_electives), len(b_electives)))
        if only_a:
            logger.info("  Only %s: %s", models[0], ", ".join(sorted(only_a)))
        if only_b:
            logger.info("  Only %s: %s", models[1], ", ".join(sorted(only_b)))

        # Term assignment diff
        a_terms = results[models[0]][0]["terms"]
        b_terms = results[models[1]][0]["terms"]
        term_diffs = []
        for code in sorted(set(a_terms) & set(b_terms)):
            if a_terms[code] != b_terms[code]:
                term_diffs.append(f"  {code}: {a_terms[code]} vs {b_terms[code]}")
        if term_diffs:
            logger.info("\n--- Term Assignment Diffs ---")
            for d in term_diffs:
                logger.info(d)
        else:
            logger.info("  Term assignments: identical for shared courses")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Benchmark academic graph generation")
    parser.add_argument("--pid", default=DEFAULT_PID, help="Program ID to benchmark")
    parser.add_argument("--goal", default=DEFAULT_GOAL, help="Student goal")
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS, help="Models to compare")
    parser.add_argument("--runs", type=int, default=1, help="Runs per model")
    args = parser.parse_args()

    run_benchmark(args.pid, args.goal, args.models, args.runs)
