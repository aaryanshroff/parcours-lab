#!/usr/bin/env python3
"""
Filter ESCO skill groups based on TOML configuration.

ESCO Hierarchy Levels (1-indexed):
- Level 1: Top categories (S, K, L, T)
- Level 2: Broad categories (S6, K1)
- Level 3: Narrower categories (S6.2)
- Level 4: Specific categories (S6.2.1)
- Level 5: Individual skills (leaf nodes from skills_en.csv)
"""

import tomllib
import typer
import pandas as pd
from pathlib import Path
from typing import Annotated
from typing import Any  # for pd.isna checks on DataFrame columns

app = typer.Typer()

DEFAULT_CONFIG = Path(__file__).parent / "filter_config.toml"


def load_toml_config(config_path: Path) -> dict:
    with open(config_path, "rb") as f:
        return tomllib.load(f)


def get_level_from_code(code: Any) -> int:
    """Get 1-indexed level from skill group code.

    Skills (S, T, L): S=1, S6=2, S6.2=3, S6.2.1=4
    Knowledge (ISCED-F): 00=1, 001=2, 0011=3, 00111=4 (by digit count)
    """
    if pd.isna(code) or code == "":
        return -1
    code = str(code)
    # ISCED-F numeric codes: level = digits - 1
    if code[0].isdigit():
        return len(code) - 1
    # Letter codes with dots
    if "." in code:
        return code.count(".") + 2
    # Single letter = level 1, letter+number = level 2
    return 1 if code.isalpha() else 2


def get_category_from_code(code: Any) -> str:
    """Extract top-level category from code.

    - S, T, L codes start with letters
    - K (knowledge) uses ISCED-F numeric codes (00-10)
    """
    if pd.isna(code) or code == "":
        return ""
    first_char = str(code)[0]
    # ISCED-F numeric codes are knowledge (K)
    if first_char.isdigit():
        return "K"
    return first_char


def get_category_from_skill_type(skill_type: Any) -> str:
    """Map skillType to category for Level 5 skills."""
    if pd.isna(skill_type):
        return ""
    if "knowledge" in str(skill_type).lower():
        return "K"
    return "S"  # skill/competence -> S


@app.command()
def main(
    config: Annotated[Path, typer.Option(help="Path to TOML config file")] = DEFAULT_CONFIG,
    data_dir: Annotated[Path, typer.Option(help="Directory with ESCO data files")] = Path(__file__).parent.parent / "data",
):
    """Filter ESCO skill groups based on TOML configuration."""

    # Load config
    typer.echo(f"Loading config from {config}")
    cfg = load_toml_config(config)

    # Per-category level ranges: {"S": [4, 4], "K": [3, 3]}
    levels_cfg = cfg["filter"]["levels"]
    exclude_codes = cfg["filter"].get("exclude_codes", [])
    exclude_prefixes = cfg["filter"].get("exclude_prefixes", [])
    output_filename = cfg["output"]["filename"]

    typer.echo("  Levels by category:")
    for cat, (min_lvl, max_lvl) in levels_cfg.items():
        typer.echo(f"    {cat}: {min_lvl} to {max_lvl}")
    if exclude_prefixes:
        typer.echo(f"  Excluding prefixes: {exclude_prefixes}")

    # Load skill groups (levels 1-4)
    typer.echo("Loading skill groups (levels 1-4)...")
    df = pd.read_csv(data_dir / "skills" / "skillGroups_en.csv")
    df["level"] = df["code"].apply(get_level_from_code)
    df["category"] = df["code"].apply(get_category_from_code)
    typer.echo(f"  Loaded {len(df)} skill groups")

    # Determine if we need Level 5 skills
    max_level_needed = max(lvl[1] for lvl in levels_cfg.values())

    # Load level 5 skills if needed
    if max_level_needed >= 5:
        typer.echo("Loading individual skills (level 5)...")
        skills_df = pd.read_csv(data_dir / "skills" / "skills_en.csv")
        skills_df["level"] = 5
        skills_df["category"] = skills_df["skillType"].apply(get_category_from_skill_type)
        skills_df["code"] = None  # Level 5 skills don't have codes
        typer.echo(f"  Loaded {len(skills_df)} individual skills")

        # Merge dataframes (keep common columns + extras)
        common_cols = ["conceptType", "conceptUri", "preferredLabel", "status", "description", "level", "category", "code"]
        df = pd.concat([
            df[[c for c in common_cols if c in df.columns]],
            skills_df[[c for c in common_cols if c in skills_df.columns]]
        ], ignore_index=True)

    # Build per-category level mask
    category_masks = []
    for cat, (min_lvl, max_lvl) in levels_cfg.items():
        cat_mask = (
            (df["category"] == cat) &
            (df["level"] >= min_lvl) &
            (df["level"] <= max_lvl)
        )
        category_masks.append(cat_mask)

    # Combine all category masks with OR
    mask = category_masks[0]
    for m in category_masks[1:]:
        mask |= m

    # Apply exclusions
    mask &= ~df["code"].isin(exclude_codes)

    if exclude_prefixes:
        prefix_pattern = "|".join(f"^{p}" for p in exclude_prefixes)
        mask &= ~df["code"].str.match(prefix_pattern, na=False)

    filtered = df[mask]

    typer.echo(f"  Filtered to {len(filtered)} items")

    # Show breakdown by category and level
    for cat in sorted(filtered["category"].unique()):
        cat_df = filtered[filtered["category"] == cat]
        levels = sorted(cat_df["level"].unique())
        counts = [f"L{lvl}:{len(cat_df[cat_df['level']==lvl])}" for lvl in levels]
        typer.echo(f"    {cat}: {', '.join(counts)}")

    # Save
    output_path = data_dir / "skills" / output_filename
    filtered.to_csv(output_path, index=False)
    typer.echo(f"Saved to {output_path}")


if __name__ == "__main__":
    app()
