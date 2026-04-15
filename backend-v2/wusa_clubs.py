"""
Scrape WUSA club listings and recommend clubs based on student profile.
"""

import json
import logging
import os
import re
import time

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

CACHE_PATH = os.path.join(os.path.dirname(__file__), "data", "clubs_cache.json")
BASE_URL = "https://clubs.wusa.ca"

CATEGORIES = {
    "academic": "Academic",
    "business-and-entrepreneurial": "Business & Entrepreneurial",
    "charitable-community-service-international-development": "Charitable & Community Service",
    "creative-arts-dance-and-music": "Creative Arts, Dance & Music",
    "cultural": "Cultural",
    "environmental-and-sustainability": "Environmental & Sustainability",
    "games-recreational-and-social": "Games, Recreational & Social",
    "health-promotion": "Health Promotion",
    "media-publications-and-web-development": "Media, Publications & Web Dev",
    "political-and-social-awareness": "Political & Social Awareness",
    "religious-and-spiritual": "Religious & Spiritual",
}


def _scrape_category_page(slug: str, page: int = 1) -> tuple[list[dict], bool]:
    """Scrape one page of a category listing. Returns (clubs, has_next_page)."""
    url = f"{BASE_URL}/club_listings/{slug}"
    if page > 1:
        url += f"?page={page}"

    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    clubs = []
    for card in soup.find_all("div", class_="card"):
        # Club name from h4
        name_el = card.find("h4")
        name = name_el.get_text(strip=True) if name_el else ""

        # Detail URL from "Learn More" link
        link = card.find("a", href=re.compile(r"^/clubs/\d+"))
        detail_url = link.get("href", "") if link else ""

        # Description — first substantial paragraph
        desc = ""
        for p in card.find_all("p"):
            text = p.get_text(strip=True)
            if text and "Last Active Term" not in text and len(text) > 20:
                desc = text
                break

        if name and detail_url:
            clubs.append({
                "name": name,
                "description": desc,
                "url": f"{BASE_URL}{detail_url}",
            })

    # Check for next page link
    has_next = bool(soup.find("a", href=re.compile(rf"/club_listings/{re.escape(slug)}\?page={page + 1}")))

    return clubs, has_next


def scrape_all_clubs() -> list[dict]:
    """Scrape all clubs from WUSA, organized by category."""
    all_clubs = []
    seen_urls = set()

    for slug, category_name in CATEGORIES.items():
        page = 1
        while True:
            logger.info("Scraping %s page %d", slug, page)
            try:
                clubs, has_next = _scrape_category_page(slug, page)
            except Exception as e:
                logger.error("Failed to scrape %s page %d: %s", slug, page, e)
                break

            for club in clubs:
                if club["url"] not in seen_urls:
                    club["category"] = category_name
                    all_clubs.append(club)
                    seen_urls.add(club["url"])

            if not has_next or not clubs:
                break
            page += 1
            time.sleep(0.3)  # be polite

        time.sleep(0.3)

    logger.info("Scraped %d clubs total", len(all_clubs))
    return all_clubs


def _load_cache() -> list[dict]:
    """Load clubs from cache file."""
    if not os.path.exists(CACHE_PATH):
        return []
    with open(CACHE_PATH) as f:
        return json.load(f)


def _save_cache(clubs: list[dict]) -> None:
    """Save clubs to cache file."""
    with open(CACHE_PATH, "w") as f:
        json.dump(clubs, f, indent=2)


def get_all_clubs(force_refresh: bool = False) -> list[dict]:
    """Get all clubs, using cache if available."""
    if not force_refresh:
        cached = _load_cache()
        if cached:
            return cached

    clubs = scrape_all_clubs()
    if clubs:
        _save_cache(clubs)
    return clubs


def recommend_clubs(
    major_title: str,
    goal: str,
    interests: list[str],
    api_key: str,
) -> list[dict]:
    """Use LLM to recommend clubs based on student profile."""
    from openai import OpenAI

    clubs = get_all_clubs()
    if not clubs:
        return []

    # Build a compact club list for the LLM
    club_lines = []
    for i, c in enumerate(clubs):
        line = f"{i}. {c['name']} [{c['category']}]"
        if c.get("description"):
            # Truncate long descriptions
            desc = c["description"][:120]
            line += f" — {desc}"
        club_lines.append(line)

    club_list_str = "\n".join(club_lines)

    profile_parts = []
    if major_title:
        profile_parts.append(f"Major: {major_title}")
    if goal:
        profile_parts.append(f"Academic goal: {goal}")
    if interests:
        profile_parts.append(f"Personal interests: {', '.join(interests)}")
    profile_str = "\n".join(profile_parts)

    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)

    prompt = (
        f"Student profile:\n{profile_str}\n\n"
        f"Available clubs at University of Waterloo:\n{club_list_str}\n\n"
        "Pick 6-8 clubs that best match this student's academic program, goals, and interests. "
        "For each club, classify it as either \"strong\" (directly relevant to their program/goals) "
        "or \"explore\" (broadens their experience in an interesting way).\n\n"
        "Return a JSON array only, no markdown:\n"
        '[{"index": <number>, "match_tier": "strong"|"explore", "reason": "<1 sentence why>"}]'
    )

    response = client.chat.completions.create(
        model="openai/gpt-4.1-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    "You recommend university extracurricular clubs to students. "
                    "Pick clubs that genuinely align with the student's profile. "
                    "Reply with valid JSON only, no markdown."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
    )

    raw = response.choices[0].message.content or "[]"
    try:
        picks = json.loads(raw)
    except json.JSONDecodeError:
        logger.error("Failed to parse LLM club recommendations: %s", raw)
        return []

    results = []
    for pick in picks:
        idx = pick.get("index")
        if idx is None or idx < 0 or idx >= len(clubs):
            continue
        club = clubs[idx]
        results.append({
            "name": club["name"],
            "category": club["category"],
            "description": club.get("description", ""),
            "url": club["url"],
            "match_tier": pick.get("match_tier", "explore"),
            "match_reason": pick.get("reason", ""),
        })

    return results
