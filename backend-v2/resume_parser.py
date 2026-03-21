import io
import json

import requests
from openai import OpenAI
from pypdf import PdfReader
from docx import Document

ESCO_SEARCH_URL = "https://ec.europa.eu/esco/api/search"


def extract_text(file_storage) -> str:
    """Extract plain text from an uploaded PDF or DOCX file."""
    filename = file_storage.filename or ""
    raw = file_storage.read()

    if filename.lower().endswith(".pdf"):
        reader = PdfReader(io.BytesIO(raw))
        return "\n".join(page.extract_text() or "" for page in reader.pages)

    if filename.lower().endswith(".docx"):
        doc = Document(io.BytesIO(raw))
        return "\n".join(p.text for p in doc.paragraphs)

    raise ValueError(f"Unsupported file type: {filename}")


def extract_skills(resume_text: str, api_key: str, model: str = "google/gemini-2.5-flash") -> list[str]:
    """Send resume text to an LLM via OpenRouter and return a list of skills."""
    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key,
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a resume skill extractor. Given a resume, extract all technical and professional skills. "
                    "Return ONLY a JSON array of strings, no other text. Example: [\"Python\", \"Machine Learning\", \"SQL\"]"
                ),
            },
            {
                "role": "user",
                "content": resume_text,
            },
        ],
        temperature=0,
    )

    return _parse_json_array(response.choices[0].message.content or "[]")


def _parse_json_array(raw: str) -> list[str]:
    """Strip markdown fences and parse a JSON array of strings."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    return json.loads(raw)


def extract_goal_skills(goal_text: str, api_key: str, model: str = "google/gemini-2.5-flash") -> dict[str, list[str]]:
    """Extract existing and desired skills from a learning goal. Returns {"existing": [...], "desired": [...]}."""
    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key,
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You analyze a learning goal to identify two categories of skills:\n"
                    "1. \"existing\" — skills the user already has or is currently working in (their background)\n"
                    "2. \"desired\" — skills the user wants to learn or transition into (their goal)\n\n"
                    "The input is free-form text. Distinguish between what the user knows and what they want to know.\n"
                    "Return ONLY a JSON object with two arrays, no other text. Keep each list concise — 3 to 8 skills max.\n"
                    'Example: {"existing": ["cybersecurity", "network administration", "Python"], "desired": ["React", "Node.js", "full-stack development"]}'
                ),
            },
            {
                "role": "user",
                "content": goal_text,
            },
        ],
        temperature=0,
    )

    raw = response.choices[0].message.content or '{"existing": [], "desired": []}'
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    parsed = json.loads(raw)
    return {"existing": parsed.get("existing", []), "desired": parsed.get("desired", [])}


def _fetch_esco_candidates(skill: str, limit: int = 5) -> list[dict]:
    """Fetch top ESCO candidates for a skill string."""
    resp = requests.get(
        ESCO_SEARCH_URL,
        params={"text": skill, "type": "skill", "language": "en", "limit": limit},
        timeout=10,
    )
    resp.raise_for_status()
    results = resp.json().get("_embedded", {}).get("results", [])
    return [{"title": r["title"], "uri": r["uri"]} for r in results]


def match_esco_skills(skills: list[str], api_key: str, model: str = "google/gemini-2.5-flash") -> list[dict]:
    """Match a list of skill strings to ESCO skills using LLM to pick the best candidate."""
    # Fetch ESCO candidates for each skill
    candidates_per_skill: dict[str, list[dict]] = {}
    for skill in skills:
        candidates_per_skill[skill] = _fetch_esco_candidates(skill)

    # Build a single LLM prompt to match all skills at once
    skill_blocks = []
    for skill in skills:
        candidates = candidates_per_skill[skill]
        if not candidates:
            skill_blocks.append(f'- "{skill}": no candidates')
        else:
            options = ", ".join(f'"{c["title"]}"' for c in candidates)
            skill_blocks.append(f'- "{skill}": [{options}]')

    prompt = (
        "For each skill below, I've provided ESCO candidate matches. "
        "Pick the single best ESCO match for each skill. If NONE of the candidates are a good semantic match, use \"NONE\".\n\n"
        + "\n".join(skill_blocks)
        + "\n\nReturn a JSON object mapping each original skill to the chosen ESCO title or \"NONE\". "
        'Example: {"Python": "Python (computer programming)", "massage therapy": "NONE"}'
    )

    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are a skill taxonomy matcher. Be strict — only match if the ESCO candidate genuinely refers to the same skill. Technical skills should match technical ESCO entries, not unrelated domains."},
            {"role": "user", "content": prompt},
        ],
        temperature=0,
    )

    raw = response.choices[0].message.content or "{}"
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    matches: dict[str, str] = json.loads(raw)

    # Build results
    results = []
    for skill in skills:
        chosen = matches.get(skill, "NONE")
        if chosen == "NONE" or not chosen:
            results.append({"raw": skill, "esco_label": skill, "esco_uri": None})
        else:
            # Find the URI for the chosen title
            uri = None
            for c in candidates_per_skill.get(skill, []):
                if c["title"] == chosen:
                    uri = c["uri"]
                    break
            results.append({"raw": skill, "esco_label": chosen, "esco_uri": uri})

    return results
