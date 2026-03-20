from services.llm import call_openrouter, get_reply_text
from services.courses import get_recommended_courses
from services.course_history import get_seen_course_ids, add_seen_courses
import json

RECOMMENDED_COURSES_TOOL_NAME = "get_recommended_courses"

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": RECOMMENDED_COURSES_TOOL_NAME,
            "description": (
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
    "If the user asks for course recommendations or courses to take, "
    f"first call the {RECOMMENDED_COURSES_TOOL_NAME} tool and then use the tool output. "
    "When tool output is available, do not list course titles or URLs in the assistant text. "
    "Keep text brief and high-level; the frontend will render course cards from structured data. "
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
            line = f"- User rejected \"{title}\""
            if reason:
                line += f" because: {reason}"
            lines.append(line)
        elif status == "accepted":
            lines.append(f"- User accepted \"{title}\"")

    if not lines:
        return _BASE_SYSTEM_INSTRUCTION

    feedback_block = (
        "\n\nThe user has given the following feedback on previously recommended courses. "
        "Use this to improve future recommendations:\n"
        + "\n".join(lines)
    )
    return _BASE_SYSTEM_INSTRUCTION + feedback_block


_RERANK_PROMPT = """\
You are a course recommendation assistant. The user has a learning goal and required skills. \
Select the {pick} best courses from the candidates below.

Goal: {goal}
Required skills: {skills}
{feedback_section}
Candidates (JSON array):
{candidates_json}

Return ONLY a JSON array of objects with "id" and "explanation" fields, e.g. \
[{{"id": "id1", "explanation": "one sentence why"}}, ...]. \
Keep each explanation to one concise sentence. If a course was chosen or avoided because of user feedback on rejected courses, say so in the explanation. \
No markdown, just the JSON array."""

_CANDIDATE_COUNT = 10
_PICK_COUNT = 3


def _llm_rerank_courses(
    candidates: list[dict[str, str]],
    goal: str,
    skills: list[str],
    course_history: list | None,
    model: str,
    pick: int = _PICK_COUNT,
) -> list[dict[str, str]]:
    feedback_section = ""
    if course_history:
        lines = []
        for entry in course_history:
            title = entry.title if hasattr(entry, "title") else entry.get("title", "")
            status = entry.status if hasattr(entry, "status") else entry.get("status", "")
            reason = entry.reason if hasattr(entry, "reason") else entry.get("reason", "")
            if status == "rejected":
                line = f"- Rejected \"{title}\""
                if reason:
                    line += f": {reason}"
                lines.append(line)
            elif status == "accepted":
                lines.append(f"- Accepted \"{title}\"")
        if lines:
            feedback_section = "\nUser feedback on past recommendations:\n" + "\n".join(lines)

    prompt = _RERANK_PROMPT.format(
        pick=pick,
        goal=goal or "(not specified)",
        skills=", ".join(skills) if skills else "(not specified)",
        feedback_section=feedback_section,
        candidates_json=json.dumps(candidates, indent=2),
    )

    result = call_openrouter(
        [{"role": "user", "content": prompt}],
        model=model,
    )
    reply = get_reply_text(result).strip()

    # Parse the JSON array of {id, explanation} objects
    try:
        clean = reply
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[1] if "\n" in clean else clean[3:]
            clean = clean.rsplit("```", 1)[0]
        parsed = json.loads(clean.strip())
        if not isinstance(parsed, list):
            raise ValueError("not a list")
    except (json.JSONDecodeError, ValueError):
        return candidates[:pick]

    # Build map of id -> explanation from the LLM response
    explanations: dict[str, str] = {}
    for item in parsed:
        if isinstance(item, dict):
            cid = str(item.get("id", ""))
            explanations[cid] = str(item.get("explanation", ""))

    reranked: list[dict[str, str]] = []
    for c in candidates:
        cid = c.get("id", "")
        if cid in explanations:
            reranked.append({**c, "explanation": explanations[cid]})

    if not reranked:
        return candidates[:pick]
    return reranked[:pick]


def execute_tool_call(
    tool_call: dict[str, str],
    goal: str = "",
    required_skills: list[str] | None = None,
    conversation_id: str = "default",
    course_history: list | None = None,
    model: str = "",
) -> tuple[dict[str, object], list[dict[str, str]]]:
    if tool_call["name"] != RECOMMENDED_COURSES_TOOL_NAME:
        raise ValueError(f"Unsupported tool '{tool_call['name']}'")

    seen_ids = get_seen_course_ids(conversation_id)
    skills = required_skills or []
    candidates = get_recommended_courses(
        goal, skills, count=_CANDIDATE_COUNT, exclude_course_ids=seen_ids,
    )

    if model and len(candidates) > _PICK_COUNT:
        courses = _llm_rerank_courses(candidates, goal, skills, course_history, model)
    else:
        courses = candidates[:_PICK_COUNT]

    add_seen_courses(conversation_id, [str(c.get("id", "")) for c in courses])
    return {"recommended_courses": courses}, courses


def resolve_tool_calls(
    tool_calls: list[dict[str, str]],
    model_messages: list[dict[str, object]],
    model: str,
    goal: str = "",
    required_skills: list[str] | None = None,
    conversation_id: str = "default",
    course_history: list | None = None,
) -> tuple[str, list[dict[str, str]]]:
    """Execute tool calls, send results back to the model, return (reply, courses)."""
    assistant_tool_calls = []
    tool_messages: list[dict[str, object]] = []
    all_courses: list[dict[str, str]] = []

    for tc in tool_calls:
        tool_output, courses = execute_tool_call(
            tc, goal, required_skills, conversation_id,
            course_history=course_history, model=model,
        )
        all_courses.extend(courses)

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
    return get_reply_text(result), all_courses
