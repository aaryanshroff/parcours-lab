from pydantic import  BaseModel, ConfigDict, field_validator
from typing import Literal

class CourseActionRequest(BaseModel):
    user_id: str
    course_id: str
    status: Literal["accepted", "rejected"]
    reason: str = ""