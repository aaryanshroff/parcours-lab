"""
Scrape club/team listings from WUSA, Sedra Design Centre, and MathSoc,
then recommend clubs based on student profile.
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
WUSA_BASE_URL = "https://clubs.wusa.ca"
SEDRA_URL = "https://uwaterloo.ca/sedra-student-design-centre/catalogs/directory-teams"
MATHSOC_URL = "https://mathsoc.uwaterloo.ca/community/community"

WUSA_CATEGORIES = {
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


# ---------------------------------------------------------------------------
# WUSA scraper
# ---------------------------------------------------------------------------

def _scrape_wusa_category_page(slug: str, page: int = 1) -> tuple[list[dict], bool]:
    """Scrape one page of a WUSA category listing. Returns (clubs, has_next_page)."""
    url = f"{WUSA_BASE_URL}/club_listings/{slug}"
    if page > 1:
        url += f"?page={page}"

    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    clubs = []
    for card in soup.find_all("div", class_="card"):
        name_el = card.find("h4")
        name = name_el.get_text(strip=True) if name_el else ""

        link = card.find("a", href=re.compile(r"^/clubs/\d+"))
        detail_url = link.get("href", "") if link else ""

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
                "url": f"{WUSA_BASE_URL}{detail_url}",
            })

    has_next = bool(soup.find("a", href=re.compile(
        rf"/club_listings/{re.escape(slug)}\?page={page + 1}"
    )))
    return clubs, has_next


def _scrape_wusa_clubs() -> list[dict]:
    """Scrape all clubs from WUSA across every category."""
    all_clubs = []
    seen_urls: set[str] = set()

    for slug, category_name in WUSA_CATEGORIES.items():
        page = 1
        while True:
            logger.info("WUSA: scraping %s page %d", slug, page)
            try:
                clubs, has_next = _scrape_wusa_category_page(slug, page)
            except Exception as e:
                logger.error("WUSA: failed to scrape %s page %d: %s", slug, page, e)
                break

            for club in clubs:
                if club["url"] not in seen_urls:
                    club["category"] = category_name
                    all_clubs.append(club)
                    seen_urls.add(club["url"])

            if not has_next or not clubs:
                break
            page += 1
            time.sleep(0.3)
        time.sleep(0.3)

    logger.info("WUSA: scraped %d clubs", len(all_clubs))
    return all_clubs


# ---------------------------------------------------------------------------
# Sedra Student Design Centre scraper
# ---------------------------------------------------------------------------

def _scrape_sedra_teams() -> list[dict]:
    """Scrape design teams from the Sedra Student Design Centre directory."""
    resp = requests.get(SEDRA_URL, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    teams: list[dict] = []
    for item in soup.select("div.item-list ul li"):
        title_div = item.select_one("div.views-field-title")
        if not title_div:
            continue
        link = title_div.find("a", href=True)
        name = link.get_text(strip=True) if link else ""
        if not name or name.startswith("*"):
            continue

        href = link["href"] if link else ""
        url = href if href.startswith("http") else f"https://uwaterloo.ca{href}"

        desc_div = item.select_one("div.views-field-field-uw-catalog-summary")
        desc = desc_div.get_text(strip=True) if desc_div else ""

        teams.append({
            "name": name,
            "description": desc,
            "url": url,
            "category": "Design Team",
        })

    logger.info("Sedra: scraped %d teams", len(teams))
    return teams


# ---------------------------------------------------------------------------
# MathSoc scraper
# ---------------------------------------------------------------------------

def _scrape_mathsoc_clubs() -> list[dict]:
    """Scrape clubs from the MathSoc community page."""
    headers = {"User-Agent": "parcours-lab/1.0 (UW student project)"}
    for attempt in range(3):
        resp = requests.get(MATHSOC_URL, timeout=15, headers=headers)
        if resp.status_code == 429:
            wait = 10 * (attempt + 1)
            logger.warning("MathSoc: rate-limited, retrying in %ds", wait)
            time.sleep(wait)
            continue
        resp.raise_for_status()
        break
    else:
        resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    clubs: list[dict] = []
    for heading in soup.find_all("h2"):
        name = heading.get_text(strip=True)
        if not name:
            continue

        desc_parts = []
        for sibling in heading.find_next_siblings():
            if sibling.name == "h2":
                break
            if sibling.name in ("p", "ul", "ol"):
                text = sibling.get_text(strip=True)
                if text:
                    desc_parts.append(text)
        desc = " ".join(desc_parts)
        if not desc:
            continue

        clubs.append({
            "name": name,
            "description": desc,
            "url": MATHSOC_URL,
            "category": "MathSoc",
        })

    logger.info("MathSoc: scraped %d clubs", len(clubs))
    return clubs


# ---------------------------------------------------------------------------
# Unified scraper
# ---------------------------------------------------------------------------

def scrape_all_clubs() -> list[dict]:
    """Scrape clubs/teams from all sources into a single unified list."""
    all_clubs: list[dict] = []
    seen_names: set[str] = set()

    def _add(clubs: list[dict]) -> None:
        for club in clubs:
            key = club["name"].lower().strip()
            if key not in seen_names:
                all_clubs.append(club)
                seen_names.add(key)

    _add(_scrape_wusa_clubs())

    try:
        _add(_scrape_sedra_teams())
    except Exception as e:
        logger.error("Sedra scrape failed: %s", e)

    try:
        _add(_scrape_mathsoc_clubs())
    except Exception as e:
        logger.error("MathSoc scrape failed: %s", e)

    logger.info("Total clubs/teams scraped: %d", len(all_clubs))
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
        "Pick 3-4 clubs from the list above.\n"
        "A club is \"strong\" ONLY if its activities directly involve the student's stated goal "
        "(e.g. for a goal of \"machine learning\", the club must do ML/AI/data science work — "
        "being a generic tech or CS club is NOT enough).\n"
        "A club is \"explore\" if it is a plausible fit based on their major or interests "
        "but does not directly address the goal.\n"
        "It is fine to return 0 strong matches if nothing truly fits the goal.\n\n"
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
                    "Be highly selective — only mark a club as \"strong\" if it has a clear, "
                    "specific connection to the student's goal. When in doubt, use \"explore\". "
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
