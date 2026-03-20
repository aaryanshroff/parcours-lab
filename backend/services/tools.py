from services.llm import call_openrouter, get_reply_text
from services.courses import get_recommended_courses
from services.course_history import get_seen_course_ids, add_seen_courses
import json

SKILL_ROADMAP_TOOL_NAME = "get_skill_roadmap"

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": SKILL_ROADMAP_TOOL_NAME,
            "description": (
                "Generate a personalized skill roadmap with course recommendations. "
                "Call this when the user asks for course recommendations, a learning path, "
                "or what they should learn."
                "Fetch personalized course recommendations. Takes no arguments — "
                "the server already knows the user's goal and skills. "
                "Call this whenever the user asks for course suggestions."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    }
]

_BASE_SYSTEM_INSTRUCTION = (
    "If the user asks for course recommendations, a learning path, or skills to learn, "
    f"first call the {SKILL_ROADMAP_TOOL_NAME} tool. "
    "When tool output is available, provide a brief high-level overview of the roadmap. "
    "The frontend renders an interactive skill-tree graph with courses attached to each skill. "
    "Do NOT list individual courses or skills in your text — keep it concise and encouraging."
    "If the user has rejected courses before, briefly explain how you took that feedback into account "
    "(e.g. 'Since you found X too advanced, I focused on more introductory options')."
)


def build_system_instruction(course_history: list | None = None) -> str:
    if not course_history:
        return _BASE_SYSTEM_INSTRUCTION

    lines: list[str] = []
    for entry in course_history:
        title = entry.title if hasattr(entry, "title") else entry.get("title", "")
        status = entry.status if hasattr(entry, "status") else entry.get("status", "")
        reason = entry.reason if hasattr(entry, "reason") else entry.get("reason", "")
        if status == "rejected":
            line = f'- User rejected "{title}"'
            if reason:
                line += f" because: {reason}"
            lines.append(line)
        elif status == "accepted":
            lines.append(f'- User accepted "{title}"')

    if not lines:
        return _BASE_SYSTEM_INSTRUCTION

    feedback_block = (
        "\n\nThe user has given the following feedback on previously recommended courses. "
        "Use this to improve future recommendations:\n"
        + "\n".join(lines)
    )
    return _BASE_SYSTEM_INSTRUCTION + feedback_block


# ── Skill-tree generation ────────────────────────────────────────────

_SKILL_TREE_PROMPT = """\
You are a learning-path architect. Identify 5-7 key skills the user needs to learn.

Goal: {goal}
Required skills (gap to fill): {required_skills}
{feedback_section}
For each skill, return:
- id: short unique identifier like "s1", "s2", etc.
- name: concise skill name (2-5 words)
- description: what this skill covers (1 sentence)
- why: why it matters for the user's goal (1 sentence)
- level: "beginner", "intermediate", or "advanced"
- depends_on: array of ids of prerequisite skills from this list (empty array if none)

Create a meaningful dependency tree — not a linear chain. Some skills can be \
learned in parallel. Order so prerequisites come first.
Return ONLY a JSON array of objects with "id" and "explanation" fields, e.g. \
[{{"id": "id1", "explanation": "one sentence why"}}, ...]. \
Keep each explanation to one concise sentence. If a course was chosen or avoided because of user feedback on rejected courses, say so in the explanation. \
No markdown, just the JSON array."""

Return ONLY a JSON array. No markdown fences, no commentary, just raw JSON."""


def _generate_skill_tree(
    goal: str,
    required_skills: list[str],
    course_history: list | None,
    model: str,
) -> list[dict]:
    feedback_section = ""
    if course_history:
        lines = []
        for entry in course_history:
            title = entry.title if hasattr(entry, "title") else entry.get("title", "")
            status = entry.status if hasattr(entry, "status") else entry.get("status", "")
            reason = entry.reason if hasattr(entry, "reason") else entry.get("reason", "")
            if status == "rejected":
                line = f'- Rejected "{title}"'
                if reason:
                    line += f": {reason}"
                lines.append(line)
            elif status == "accepted":
                lines.append(f'- Accepted "{title}"')
        if lines:
            feedback_section = (
                "\nUser feedback on past recommendations:\n" + "\n".join(lines)
            )

    prompt = _SKILL_TREE_PROMPT.format(
        goal=goal or "(not specified)",
        required_skills=", ".join(required_skills) if required_skills else "(infer from the goal)",
        feedback_section=feedback_section,
    )

    result = call_openrouter(
        [{"role": "user", "content": prompt}],
        model=model,
    )
    reply = get_reply_text(result).strip()

    try:
        clean = reply
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[1] if "\n" in clean else clean[3:]
            clean = clean.rsplit("```", 1)[0]
        parsed = json.loads(clean.strip())
        if not isinstance(parsed, list):
            raise ValueError("not a list")
        return parsed
    except (json.JSONDecodeError, ValueError):
        # Fallback: build a simple linear tree from the required_skills
        return [
            {
                "id": f"s{i + 1}",
                "name": skill,
                "description": f"Learn {skill}",
                "why": "Required for your learning goal",
                "level": "intermediate",
                "depends_on": [f"s{i}"] if i > 0 else [],
            }
            for i, skill in enumerate(required_skills[:5])
        ]


# ── Course attachment ────────────────────────────────────────────────

def _attach_courses(
    skills: list[dict],
    goal: str,
    conversation_id: str,
) -> list[dict]:
    """For each skill in the tree, find the best-matching course."""
    seen_ids = get_seen_course_ids(conversation_id)
    used_ids: set[str] = set()

    for skill in skills:
        name = skill.get("name", "")
        desc = skill.get("description", "")
        query = " ".join(filter(None, [goal, name, desc]))

        candidates = get_recommended_courses(
            query, [name], count=3,
            exclude_course_ids=seen_ids | used_ids,
        )

        if candidates:
            course = candidates[0]
            cid = str(course.get("id", ""))
            used_ids.add(cid)
            add_seen_courses(conversation_id, [cid])
            skill["course"] = course
        else:
            skill["course"] = None
    # Build map of id -> explanation from the LLM response
    explanations: dict[str, str] = {}
    for item in parsed:
        if isinstance(item, dict):
            cid = str(item.get("id", ""))
            explanations[cid] = str(item.get("explanation", ""))

    return skills


# ── Tool execution ───────────────────────────────────────────────────

def execute_tool_call(
    tool_call: dict[str, str],
    goal: str = "",
    required_skills: list[str] | None = None,
    conversation_id: str = "default",
    course_history: list | None = None,
    model: str = "",
) -> tuple[dict[str, object], dict[str, object]]:
    if tool_call["name"] != SKILL_ROADMAP_TOOL_NAME:
        raise ValueError(f"Unsupported tool '{tool_call['name']}'")

    skills = _generate_skill_tree(
        goal, required_skills or [], course_history, model,
    )
    skills = _attach_courses(skills, goal, conversation_id)

    roadmap = {"skills": skills}
    return {"skill_roadmap": roadmap}, roadmap


def resolve_tool_calls(
    tool_calls: list[dict[str, str]],
    model_messages: list[dict[str, object]],
    model: str,
    goal: str = "",
    required_skills: list[str] | None = None,
    conversation_id: str = "default",
    course_history: list | None = None,
) -> tuple[str, dict[str, object]]:
    """Execute tool calls, send results back to the model, return (reply, roadmap)."""
    assistant_tool_calls = []
    tool_messages: list[dict[str, object]] = []
    roadmap: dict[str, object] = {}

    for tc in tool_calls:
        tool_output, tc_roadmap = execute_tool_call(
            tc, goal, required_skills, conversation_id,
            course_history=course_history, model=model,
        )
        if tc_roadmap:
            roadmap = tc_roadmap

        assistant_tool_calls.append({
            "id": tc["id"],
            "type": "function",
            "function": {"name": tc["name"], "arguments": tc.get("arguments", "")},
        })
        tool_messages.append({
            "role": "tool",
            "tool_call_id": tc["id"],
            "content": json.dumps(tool_output),
        })

    followup_messages = [
        *model_messages,
        {"role": "assistant", "content": "", "tool_calls": assistant_tool_calls},
        *tool_messages,
    ]
    result = call_openrouter(followup_messages, model=model, tools=TOOLS, tool_choice="auto")
    return get_reply_text(result), roadmap
