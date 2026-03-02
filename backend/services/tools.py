from services.llm import call_openrouter, get_reply_text
from services.courses import get_recommended_courses
import json

RECOMMENDED_COURSES_TOOL_NAME = "get_recommended_courses"

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": RECOMMENDED_COURSES_TOOL_NAME,
            "description": (
                "Return recommended courses based on the user's goal and required skills. "
                "Call this when the user asks for course recommendations."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    }
]

SYSTEM_TOOL_INSTRUCTION = (
    "If the user asks for course recommendations or courses to take, "
    f"first call the {RECOMMENDED_COURSES_TOOL_NAME} tool and then use the tool output. "
    "When tool output is available, do not list course titles or URLs in the assistant text. "
    "Keep text brief and high-level; the frontend will render course cards from structured data."
)


def execute_tool_call(
    tool_call: dict[str, str],
    goal: str = "",
    required_skills: list[str] | None = None,
) -> tuple[dict[str, object], list[dict[str, str]]]:
    if tool_call["name"] != RECOMMENDED_COURSES_TOOL_NAME:
        raise ValueError(f"Unsupported tool '{tool_call['name']}'")

    courses = get_recommended_courses(goal, required_skills or [])
    return {"recommended_courses": courses}, courses


def resolve_tool_calls(
    tool_calls: list[dict[str, str]],
    model_messages: list[dict[str, object]],
    model: str,
    goal: str = "",
    required_skills: list[str] | None = None,
) -> tuple[str, list[dict[str, str]]]:
    """Execute tool calls, send results back to the model, return (reply, courses)."""
    assistant_tool_calls = []
    tool_messages: list[dict[str, object]] = []
    all_courses: list[dict[str, str]] = []

    for tc in tool_calls:
        tool_output, courses = execute_tool_call(tc, goal, required_skills)
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
