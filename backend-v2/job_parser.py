import json
import re

import requests
from bs4 import BeautifulSoup
from openai import OpenAI

# Headings that typically contain skill requirements
_SKILL_HEADINGS = re.compile(
    r"(requirements|qualifications|skills|what you.ll need|must.have|nice.to.have|"
    r"what we.re looking for|who you are|your background|tech stack|about you)",
    re.IGNORECASE,
)


def fetch_job_posting(url: str) -> str:
    """Fetch a job posting URL and extract relevant sections, or fall back to full text."""
    resp = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")

    # Remove script/style noise
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    # Try to find relevant sections by heading
    sections: list[str] = []
    for heading in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "strong", "b"]):
        if _SKILL_HEADINGS.search(heading.get_text(strip=True)):
            # Grab all sibling content until the next heading
            content_parts = []
            for sibling in heading.find_next_siblings():
                if sibling.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
                    break
                text = sibling.get_text(separator=" ", strip=True)
                if text:
                    content_parts.append(text)
            if content_parts:
                sections.append(heading.get_text(strip=True) + "\n" + "\n".join(content_parts))

    if sections:
        return "\n\n".join(sections)

    # Fallback: full page text
    return soup.get_text(separator="\n", strip=True)


def extract_job_skills(posting_text: str, api_key: str, model: str = "openai/gpt-4.1-mini") -> list[str]:
    """Extract skills from job posting text via LLM."""
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
                    "You extract skills from a job posting. Given job posting text, identify the specific technical "
                    "and professional skills required or preferred. "
                    "Return ONLY a JSON array of strings, no other text. "
                    'Example: ["React", "TypeScript", "PostgreSQL", "CI/CD", "Agile"]'
                ),
            },
            {
                "role": "user",
                "content": posting_text[:8000],  # Limit to avoid token overflow
            },
        ],
        temperature=0,
    )

    raw = response.choices[0].message.content or "[]"
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    return json.loads(raw)
