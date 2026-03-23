from pydantic import BaseModel


class Position(BaseModel):
    x: float
    y: float


class Course(BaseModel):
    title: str
    url: str
    reason: str = ""


class SkillNode(BaseModel):
    id: str
    labels: list[str]
    tier: str
    course: Course
    position: Position


class Edge(BaseModel):
    id: str
    source: str
    target: str


class GraphResponse(BaseModel):
    goal: str
    skills: list[str]
    nodes: list[SkillNode]
    edges: list[Edge]
