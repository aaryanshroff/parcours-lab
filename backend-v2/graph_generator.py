import json
from urllib.parse import quote_plus

import requests
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
    return _build_graph_response(goal, raw, existing_skills)


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
                    "and desired skills (that the user wants to learn), recommend courses ONLY for the desired skills.\n\n"
                    "Rules:\n"
                    "- ONLY create nodes for the desired skills — do NOT add prerequisite or bridge skills\n"
                    "- Use the EXACT desired skill names as provided by the user for node labels — do NOT rename or normalize them\n"
                    "- Each node must represent a DISTINCT desired skill\n"
                    "- A skill may have multiple course nodes if it benefits from more than one course\n"
                    "- A single course may cover multiple desired skills — create a node for each skill it covers\n"
                    "- Each node must have a recommended course with a title and URL (use real, well-known courses)\n"
                    "- Assign each node a tier: foundation, core, advanced, or specialization based on suggested learning order\n"
                    "- Dependencies should only list DIRECT prerequisites — if A depends on B and B depends on C, do NOT list C as a dependency of A (it is implied through B)\n"
                    "- Dependencies represent recommended learning order between the desired skills\n"
                    "- Dependencies must only reference other node IDs in your output\n"
                    "- Node IDs should be short kebab-case slugs\n"
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
                    '      "course_reason": "One sentence explaining why this course is a good fit for this skill and goal.",\n'
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



def _build_graph_response(goal: str, raw: dict, existing_skills: list[str] | None = None) -> GraphResponse:
    """Take raw LLM output and compute layout positions."""
    existing_lower = {s.lower() for s in (existing_skills or [])}
    llm_nodes = [n for n in raw.get("nodes", []) if n.get("label", "").lower() not in existing_lower]

    # Deduplicate nodes by label (keep first, merge dependencies)
    seen: dict[str, dict] = {}
    deduped: list[dict] = []
    id_remap: dict[str, str] = {}  # old id -> kept id
    for node in llm_nodes:
        label_lower = node["label"].lower()
        if label_lower in seen:
            # Remap this duplicate's id to the kept node's id
            id_remap[node["id"]] = seen[label_lower]["id"]
            # Merge dependencies
            existing_deps = set(seen[label_lower].get("dependencies", []))
            for dep in node.get("dependencies", []):
                existing_deps.add(dep)
            seen[label_lower]["dependencies"] = list(existing_deps)
        else:
            seen[label_lower] = node
            deduped.append(node)

    # Remap dependency references to point to kept nodes
    for node in deduped:
        node["dependencies"] = [
            id_remap.get(dep, dep) for dep in node.get("dependencies", [])
            if id_remap.get(dep, dep) != node["id"]  # no self-loops
        ]
    llm_nodes = deduped

    # Transitive reduction: remove edges implied by longer paths
    node_ids = {n["id"] for n in llm_nodes}
    adj: dict[str, set[str]] = {n["id"]: set() for n in llm_nodes}
    for node in llm_nodes:
        for dep in node.get("dependencies", []):
            if dep in node_ids:
                adj[dep].add(node["id"])

    def has_path(src: str, dst: str, skip_direct: bool) -> bool:
        """BFS from src to dst, optionally skipping the direct edge."""
        visited = set()
        queue = []
        for nxt in adj[src]:
            if skip_direct and nxt == dst:
                continue
            queue.append(nxt)
        while queue:
            cur = queue.pop()
            if cur == dst:
                return True
            if cur in visited:
                continue
            visited.add(cur)
            queue.extend(adj[cur] - visited)
        return False

    for node in llm_nodes:
        node["dependencies"] = [
            dep for dep in node.get("dependencies", [])
            if dep in node_ids and not has_path(dep, node["id"], skip_direct=True)
        ]

    # Group nodes by tier
    tier_groups: dict[str, list[dict]] = {t: [] for t in TIER_ORDER}
    for node in llm_nodes:
        tier = node.get("tier", "core")
        if tier not in tier_groups:
            tier = "core"
        tier_groups[tier].append(node)

    # Verify course URLs
    for node in llm_nodes:
        url = node.get("course_url", "")
        if url:
            try:
                resp = requests.head(url, timeout=5, allow_redirects=True)
                if resp.status_code >= 400:
                    node["course_url"] = f"https://www.coursera.org/search?query={quote_plus(node.get('course_title', node['label']))}"
            except (requests.RequestException, Exception):
                node["course_url"] = f"https://www.coursera.org/search?query={quote_plus(node.get('course_title', node['label']))}"

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
                        reason=node.get("course_reason", ""),
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
