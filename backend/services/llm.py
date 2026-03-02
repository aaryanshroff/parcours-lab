from openrouter.components.chatresponse import ChatResponse
from openrouter import OpenRouter
from schemas.chat import DEFAULT_MODEL
import os


def call_openrouter(
    messages: list[dict[str, object]],
    model: str = DEFAULT_MODEL,
    tools: list[dict[str, object]] | None = None,
    tool_choice: str | None = None,
) -> ChatResponse:
    """Send chat completion request to OpenRouter and return parsed JSON."""
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise EnvironmentError("OPENROUTER_API_KEY not configured")

    with OpenRouter(api_key=api_key) as client:
        return client.chat.send(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice=tool_choice,
        )


def get_reply_text(result: ChatResponse) -> str:
    """Extract assistant message text from OpenRouter response."""
    return result.choices[0].message.content or ""


def extract_tool_calls(result: ChatResponse) -> list[dict[str, str]]:
    tool_calls = getattr(result.choices[0].message, "tool_calls", None) if result.choices else None
    if not tool_calls:
        return []

    return [
        {"id": tc.id, "name": tc.function.name, "arguments": tc.function.arguments or ""}
        for tc in tool_calls
        if tc.id and tc.function and tc.function.name
    ]
