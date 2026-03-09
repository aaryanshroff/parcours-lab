from pydantic import BaseModel, field_validator


class BuildProfileRequest(BaseModel):
    bio: str

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
