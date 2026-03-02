from pydantic import BaseModel, ConfigDict, field_validator
from typing import Literal

DEFAULT_MODEL = "google/gemini-2.5-flash"


class ContentPart(BaseModel):
    model_config = ConfigDict(extra="allow")
    type: str
    text: str | None = None


class ThreadMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: list[ContentPart]

    def text_content(self) -> str:
        return "\n".join(
            p.text.strip()
            for p in self.content
            if p.type == "text" and p.text and p.text.strip()
        )


class ChatRequest(BaseModel):
    messages: list[ThreadMessage]
    model: str = DEFAULT_MODEL
    goal: str = ""
    required_skills: list[str] = []

    @field_validator("model")
    @classmethod
    def model_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("'model' must be a non-empty string")
        return v

    def to_openrouter_messages(self) -> list[dict[str, str]]:
        normalized = [
            {"role": m.role, "content": m.text_content()}
            for m in self.messages
            if m.text_content()
        ]
        if not normalized:
            raise ValueError("No text content found in messages")
        return normalized
