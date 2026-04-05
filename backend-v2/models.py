from pydantic import BaseModel


class Position(BaseModel):
    x: float
    y: float


class CourseRating(BaseModel):
    liked: float | None = None
    easy: float | None = None
    useful: float | None = None
    filled_count: int | None = None


class Course(BaseModel):
    title: str
    url: str
    reason: str = ""
    units: float = 0.5
    rating: CourseRating | None = None


class SkillNode(BaseModel):
    id: str
    labels: list[str]
    tier: str
    course: Course
    position: Position
    term: str = ""
    esco_skills: list[str] = []
    required: bool = False


class Edge(BaseModel):
    id: str
    source: str
    target: str


class GraphResponse(BaseModel):
    goal: str
    skills: list[str]
    nodes: list[SkillNode]
    edges: list[Edge]
