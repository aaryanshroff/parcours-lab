import json

from openai import OpenAI

from models import GraphResponse, SkillNode, Edge, Course, Position

TIER_ORDER = ["foundation", "core", "advanced", "specialization"]
GAP_X = 290
GAP_Y = 220


def generate_learning_path(
    goal: str,
    existing_skills: list[str],
    desired_skills: list[str],
    api_key: str,
    model: str = "google/gemini-2.5-flash",
) -> GraphResponse:
    """Generate a learning path graph from goal and skills via LLM, then compute layout."""
    raw = _call_llm(goal, existing_skills, desired_skills, api_key, model)
    return _build_graph_response(goal, raw)


def _call_llm(
    goal: str,
    existing_skills: list[str],
    desired_skills: list[str],
    api_key: str,
    model: str,
) -> dict:
    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)

    existing_str = ", ".join(existing_skills) if existing_skills else "none"
    desired_str = ", ".join(desired_skills) if desired_skills else "none specified"

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a learning path architect. Given a learning goal, existing skills (that the user already knows), "
                    "and desired skills (that the user wants to learn), generate a skill tree.\n\n"
                    "Rules:\n"
                    "- Do NOT include skills the user already has as nodes\n"
                    "- Include the desired skills as target nodes\n"
                    "- Fill in prerequisite skills that bridge from the user's existing knowledge to the desired skills\n"
                    "- Each node must have a recommended course with a title and URL (use real, well-known courses)\n"
                    "- Assign each node a tier: foundation, core, advanced, or specialization\n"
                    "  - foundation: basic prerequisites the user needs first\n"
                    "  - core: essential skills that build on foundations\n"
                    "  - advanced: deeper skills that require core knowledge\n"
                    "  - specialization: specific target skills at the end of the path\n"
                    "- Dependencies must only reference other node IDs in your output\n"
                    "- Node IDs should be short kebab-case slugs\n"
                    "- Aim for 6-12 nodes total\n"
                    "- Every node except foundation nodes must have at least one dependency\n"
                    "- The graph must be a DAG (no cycles)\n\n"
                    "Return ONLY valid JSON, no other text. Schema:\n"
                    "{\n"
                    '  "nodes": [\n'
                    "    {\n"
                    '      "id": "node-slug",\n'
                    '      "label": "Skill Name",\n'
                    '      "tier": "foundation|core|advanced|specialization",\n'
                    '      "course_title": "Course Name — Provider",\n'
                    '      "course_url": "https://...",\n'
                    '      "dependencies": ["other-node-id"]\n'
                    "    }\n"
                    "  ]\n"
                    "}"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Goal: {goal}\n"
                    f"Existing skills (exclude these): {existing_str}\n"
                    f"Desired skills (target these): {desired_str}"
                ),
            },
        ],
        temperature=0.3,
    )

    raw = response.choices[0].message.content or "{}"
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    return json.loads(raw)


def _build_graph_response(goal: str, raw: dict) -> GraphResponse:
    """Take raw LLM output and compute layout positions."""
    llm_nodes = raw.get("nodes", [])

    # Group nodes by tier
    tier_groups: dict[str, list[dict]] = {t: [] for t in TIER_ORDER}
    for node in llm_nodes:
        tier = node.get("tier", "core")
        if tier not in tier_groups:
            tier = "core"
        tier_groups[tier].append(node)

    # Compute positions: each tier is a row, nodes spread horizontally and centered
    positioned_nodes: list[SkillNode] = []
    all_edges: list[Edge] = []
    all_skills: list[str] = []

    for row, tier in enumerate(TIER_ORDER):
        group = tier_groups[tier]
        if not group:
            continue
        # Center the group horizontally
        total_width = (len(group) - 1) * GAP_X
        start_x = -total_width / 2
        for col, node in enumerate(group):
            x = start_x + col * GAP_X
            y = row * GAP_Y
            positioned_nodes.append(
                SkillNode(
                    id=node["id"],
                    label=node["label"],
                    tier=tier,
                    course=Course(
                        title=node.get("course_title", ""),
                        url=node.get("course_url", ""),
                    ),
                    position=Position(x=x, y=y),
                )
            )
            all_skills.append(node["label"])

            # Create edges from dependencies
            for dep_id in node.get("dependencies", []):
                edge_id = f"e-{dep_id}-{node['id']}"
                all_edges.append(Edge(id=edge_id, source=dep_id, target=node["id"]))

    return GraphResponse(
        goal=goal,
        skills=all_skills,
        nodes=positioned_nodes,
        edges=all_edges,
    )
