from pydantic import BaseModel, field_validator
from typing import Optional


class BuildProfileRequest(BaseModel):
    bio: str
    current_skills: Optional[list[dict]] = None
    required_skills: Optional[list[dict]] = None

    @field_validator("bio")
    @classmethod
    def bio_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("'bio' must be a non-empty string")
        return v


class SetSkillsRequest(BaseModel):
    skills: list[str]


class SetGoalRequest(BaseModel):
    goal: str
