from services.llm import call_openrouter, get_reply_text
from services.courses import get_recommended_courses
import json

RECOMMENDED_COURSES_TOOL_NAME = "get_recommended_courses"
UPDATE_PROFILE_TOOL_NAME = "update_user_profile"

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
    },
    {
        "type": "function",
        "function": {
            "name": UPDATE_PROFILE_TOOL_NAME,
            "description": (
                "Update the user's profile (goal, current skills, or required skills). "
                "Call this when the user wants to add, remove, or change their skills or goal through the chat. "
                "Supports multiple updates in one call. Each update specifies a field, an action, and value(s)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "updates": {
                        "type": "array",
                        "description": "List of profile changes to apply.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "field": {
                                    "type": "string",
                                    "enum": ["goal", "current_skills", "required_skills"],
                                    "description": (
                                        "Which profile field to update. "
                                        "'goal' is the user's learning/career goal (a string). "
                                        "'current_skills' are the skills the user already has. "
                                        "'required_skills' are the skills the user wants to learn."
                                    ),
                                },
                                "action": {
                                    "type": "string",
                                    "enum": ["add", "remove", "set"],
                                    "description": (
                                        "'add' appends values to a list field. "
                                        "'remove' removes values from a list field. "
                                        "'set' replaces the field entirely (use for goal or to overwrite a list)."
                                    ),
                                },
                                "value": {
                                    "type": "string",
                                    "description": (
                                        "For 'goal': the goal text. "
                                        "For skill fields: a comma-separated list of skill names "
                                        "(e.g. 'Python, Docker, SQL')."
                                    ),
                                },
                            },
                            "required": ["field", "action", "value"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["updates"],
                "additionalProperties": False,
            },
        },
    },
]

SYSTEM_TOOL_INSTRUCTION = (
    "You are a helpful course-recommendation and profile-management assistant. "
    "The user's current profile is provided below so you know their context.\n\n"
    "PROFILE MANAGEMENT:\n"
    f"When the user asks to add, remove, or change their skills or goal, call the {UPDATE_PROFILE_TOOL_NAME} tool. "
    "Always confirm what you understood the user wants before the change is applied. "
    "The user will see a confirmation card and can accept or revert.\n\n"
    "COURSE RECOMMENDATIONS:\n"
    "If the user asks for course recommendations or courses to take, "
    f"first call the {RECOMMENDED_COURSES_TOOL_NAME} tool and then use the tool output. "
    "When tool output is available, do not list course titles or URLs in the assistant text. "
    "Keep text brief and high-level; the frontend will render course cards from structured data."
)


def build_system_prompt(goal: str = "", current_skills: list[str] | None = None, required_skills: list[str] | None = None) -> str:
    """Build full system prompt including the user's current profile context."""
    profile_lines = ["Current user profile:"]
    profile_lines.append(f"  Goal: {goal or '(not set)'}")
    profile_lines.append(f"  Current skills: {', '.join(current_skills) if current_skills else '(none)'}")
    profile_lines.append(f"  Required skills (want to learn): {', '.join(required_skills) if required_skills else '(none)'}")
    profile_section = "\n".join(profile_lines)
    return f"{SYSTEM_TOOL_INSTRUCTION}\n\n{profile_section}"


def _execute_profile_update(
    updates_raw: list[dict],
    current_goal: str,
    current_skills: list[str],
    required_skills: list[str],
) -> dict:
    """
    Compute proposed profile changes.

    Returns a dict with:
      - proposed_updates: list of {field, action, value, previous_value} for the frontend
      - summary: human-readable summary
    """
    proposed = []

    for upd in updates_raw:
        field = upd["field"]
        action = upd["action"]
        raw_value = upd["value"]

        # Normalise value: the LLM always sends a string.
        # For skill fields, split comma-separated values into a list.
        if field in ("current_skills", "required_skills"):
            if isinstance(raw_value, list):
                value = [v.strip() for v in raw_value if v.strip()]
            else:
                value = [v.strip() for v in str(raw_value).split(",") if v.strip()]
        else:
            value = raw_value

        if field == "goal":
            previous = current_goal
            proposed.append({
                "field": field,
                "action": action,
                "value": value if isinstance(value, str) else " ".join(value),
                "previous_value": previous,
            })

        elif field == "current_skills":
            previous = list(current_skills)
            if action == "add":
                new_items = [v for v in value if v not in current_skills]
                if new_items:
                    proposed.append({
                        "field": field,
                        "action": "add",
                        "value": new_items,
                        "previous_value": previous,
                    })
            elif action == "remove":
                removed = [v for v in value if v in current_skills]
                if removed:
                    proposed.append({
                        "field": field,
                        "action": "remove",
                        "value": removed,
                        "previous_value": previous,
                    })
            elif action == "set":
                proposed.append({
                    "field": field,
                    "action": "set",
                    "value": value,
                    "previous_value": previous,
                })

        elif field == "required_skills":
            previous = list(required_skills)
            if action == "add":
                new_items = [v for v in value if v not in required_skills]
                if new_items:
                    proposed.append({
                        "field": field,
                        "action": "add",
                        "value": new_items,
                        "previous_value": previous,
                    })
            elif action == "remove":
                removed = [v for v in value if v in required_skills]
                if removed:
                    proposed.append({
                        "field": field,
                        "action": "remove",
                        "value": removed,
                        "previous_value": previous,
                    })
            elif action == "set":
                proposed.append({
                    "field": field,
                    "action": "set",
                    "value": value,
                    "previous_value": previous,
                })

    # Build a human-readable summary
    parts = []
    for p in proposed:
        if p["field"] == "goal":
            parts.append(f"Set goal to \"{p['value']}\"")
        elif p["action"] == "add":
            parts.append(f"Add {', '.join(p['value'])} to {p['field'].replace('_', ' ')}")
        elif p["action"] == "remove":
            parts.append(f"Remove {', '.join(p['value'])} from {p['field'].replace('_', ' ')}")
        elif p["action"] == "set":
            parts.append(f"Set {p['field'].replace('_', ' ')} to [{', '.join(p['value'])}]")

    return {
        "proposed_updates": proposed,
        "summary": "; ".join(parts) if parts else "No changes needed.",
    }


def execute_tool_call(
    tool_call: dict[str, str],
    goal: str = "",
    current_skills: list[str] | None = None,
    required_skills: list[str] | None = None,
) -> tuple[dict[str, object], list[dict[str, str]], list[dict] | None]:
    """
    Execute a single tool call.

    Returns (tool_output, recommended_courses, profile_updates_or_none).
    """
    name = tool_call["name"]

    if name == RECOMMENDED_COURSES_TOOL_NAME:
        courses = get_recommended_courses(goal, required_skills or [])
        return {"recommended_courses": courses}, courses, None

    if name == UPDATE_PROFILE_TOOL_NAME:
        args = json.loads(tool_call.get("arguments", "{}"))
        updates_raw = args.get("updates", [])
        result = _execute_profile_update(
            updates_raw,
            current_goal=goal,
            current_skills=current_skills or [],
            required_skills=required_skills or [],
        )
        return result, [], result.get("proposed_updates")

    raise ValueError(f"Unsupported tool '{name}'")


def resolve_tool_calls(
    tool_calls: list[dict[str, str]],
    model_messages: list[dict[str, object]],
    model: str,
    goal: str = "",
    current_skills: list[str] | None = None,
    required_skills: list[str] | None = None,
) -> tuple[str, list[dict[str, str]], list[dict] | None]:
    """Execute tool calls, send results back to the model, return (reply, courses, profile_updates)."""
    assistant_tool_calls = []
    tool_messages: list[dict[str, object]] = []
    all_courses: list[dict[str, str]] = []
    all_profile_updates: list[dict] = []

    for tc in tool_calls:
        tool_output, courses, profile_updates = execute_tool_call(
            tc, goal, current_skills, required_skills,
        )
        all_courses.extend(courses)
        if profile_updates:
            all_profile_updates.extend(profile_updates)

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
    return (
        get_reply_text(result),
        all_courses,
        all_profile_updates if all_profile_updates else None,
    )
