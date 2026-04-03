from pydantic import BaseModel


class Position(BaseModel):
    x: float
    y: float


class Course(BaseModel):
    title: str
    url: str
    reason: str = ""
    units: float = 0.5


class SkillNode(BaseModel):
    id: str
    labels: list[str]
    tier: str
    course: Course
    position: Position
    term: str = ""
    is_locked: bool = False        # rule="all": this exact course is mandatory, no swapping
    is_required: bool = False      # rule=N: slot must be filled, but course can be swapped within choice_options
    choice_options: list[str] = [] # sibling codes available for swapping (only set when not locked)


class Edge(BaseModel):
    id: str
    source: str
    target: str


class GraphResponse(BaseModel):
    goal: str
    skills: list[str]
    nodes: list[SkillNode]
    edges: list[Edge]
