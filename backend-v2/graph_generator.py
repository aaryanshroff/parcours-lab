import json
from concurrent.futures import ThreadPoolExecutor, as_completed
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
    model: str = "openai/gpt-4.1-mini",
) -> GraphResponse:
    """Generate a learning path graph from goal and skills via LLM, then compute layout."""
    import logging, time as _time
    _logger = logging.getLogger("graph_generator")
    t0 = _time.perf_counter()

    raw = _call_llm(goal, existing_skills, desired_skills, api_key, model)
    _logger.info("[skill-tree][timing] LLM call — %.2fs", _time.perf_counter() - t0)

    result = _build_graph_response(goal, raw, existing_skills)
    _logger.info("[skill-tree][timing] build_graph_response — %.2fs total", _time.perf_counter() - t0)
    return result


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
                    "- If a single course covers multiple desired skills, create ONE node with all those skills in the labels array\n"
                    "- Each desired skill should appear in exactly one node's labels array\n"
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
                    '      "labels": ["Skill Name", "Another Skill"],\n'
                    '      "tier": "foundation|core|advanced|specialization",\n'
                    '      "course_title": "Course Name — Provider",\n'
                    '      "course_url": "https://...",\n'
                    '      "course_reason": "One sentence explaining why this course is a good fit for these skills and goal.",\n'
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

    # Normalize: accept both "label" (string) and "labels" (list) from LLM
    for node in raw.get("nodes", []):
        if "labels" not in node:
            node["labels"] = [node.get("label", "")]
        node["labels"] = [l for l in node["labels"] if l.lower() not in existing_lower]

    llm_nodes = [n for n in raw.get("nodes", []) if n.get("labels")]

    # Merge nodes that share the same course title (safety net)
    by_course: dict[str, dict] = {}
    merged: list[dict] = []
    id_remap: dict[str, str] = {}
    for node in llm_nodes:
        course_key = node.get("course_title", "").strip().lower()
        if course_key and course_key in by_course:
            kept = by_course[course_key]
            id_remap[node["id"]] = kept["id"]
            # Merge labels (deduped)
            existing_labels = {l.lower() for l in kept["labels"]}
            for l in node["labels"]:
                if l.lower() not in existing_labels:
                    kept["labels"].append(l)
                    existing_labels.add(l.lower())
            # Merge dependencies
            existing_deps = set(kept.get("dependencies", []))
            for dep in node.get("dependencies", []):
                existing_deps.add(dep)
            kept["dependencies"] = list(existing_deps)
        else:
            if course_key:
                by_course[course_key] = node
            merged.append(node)

    # Remap dependency references to point to kept nodes
    for node in merged:
        node["dependencies"] = [
            id_remap.get(dep, dep) for dep in node.get("dependencies", [])
            if id_remap.get(dep, dep) != node["id"]  # no self-loops
        ]
    llm_nodes = merged

    # Step 1: Remove cycles via DFS back-edge detection
    node_ids = {n["id"] for n in llm_nodes}
    adj: dict[str, set[str]] = {n["id"]: set() for n in llm_nodes}
    for node in llm_nodes:
        for dep in node.get("dependencies", []):
            if dep in node_ids:
                adj[dep].add(node["id"])

    visited: set[str] = set()
    in_stack: set[str] = set()
    back_edges: set[tuple[str, str]] = set()

    def _dfs(nid: str) -> None:
        visited.add(nid)
        in_stack.add(nid)
        for nxt in adj.get(nid, set()):
            if nxt in in_stack:
                back_edges.add((nid, nxt))
            elif nxt not in visited:
                _dfs(nxt)
        in_stack.discard(nid)

    for nid in node_ids:
        if nid not in visited:
            _dfs(nid)

    for node in llm_nodes:
        node["dependencies"] = [
            dep for dep in node.get("dependencies", [])
            if dep in node_ids and (dep, node["id"]) not in back_edges
        ]

    # Step 2: Transitive reduction on the now-acyclic graph
    # Rebuild adj after cycle removal
    adj = {n["id"]: set() for n in llm_nodes}
    for node in llm_nodes:
        for dep in node.get("dependencies", []):
            adj[dep].add(node["id"])

    def _has_path(src: str, dst: str) -> bool:
        """BFS from src to dst, skipping the direct edge."""
        queue = [nxt for nxt in adj[src] if nxt != dst]
        seen: set[str] = set()
        while queue:
            cur = queue.pop()
            if cur == dst:
                return True
            if cur in seen:
                continue
            seen.add(cur)
            queue.extend(adj.get(cur, set()) - seen)
        return False

    for node in llm_nodes:
        node["dependencies"] = [
            dep for dep in node.get("dependencies", [])
            if not _has_path(dep, node["id"])
        ]

    # Group nodes by tier
    tier_groups: dict[str, list[dict]] = {t: [] for t in TIER_ORDER}
    for node in llm_nodes:
        tier = node.get("tier", "core")
        if tier not in tier_groups:
            tier = "core"
        tier_groups[tier].append(node)

    # Verify course URLs in parallel
    import logging, time as _time
    _logger = logging.getLogger("graph_generator")
    _url_t0 = _time.perf_counter()

    def _check_url(node: dict) -> tuple[str, str | None]:
        """Return (node_id, fallback_url_or_None)."""
        url = node.get("course_url", "")
        if not url:
            return node["id"], None
        fallback = f"https://www.coursera.org/search?query={quote_plus(node.get('course_title', node['labels'][0]))}"
        try:
            resp = requests.head(url, timeout=5, allow_redirects=True)
            if resp.status_code >= 400:
                return node["id"], fallback
        except (requests.RequestException, Exception):
            return node["id"], fallback
        return node["id"], None

    nodes_with_urls = [n for n in llm_nodes if n.get("course_url")]
    if nodes_with_urls:
        with ThreadPoolExecutor(max_workers=min(10, len(nodes_with_urls))) as pool:
            futures = {pool.submit(_check_url, n): n for n in nodes_with_urls}
            for fut in as_completed(futures):
                node_id, fallback = fut.result()
                if fallback:
                    node_by_id = next(n for n in llm_nodes if n["id"] == node_id)
                    node_by_id["course_url"] = fallback

    _logger.info("[skill-tree][timing] URL verification (%d urls) — %.2fs", len(nodes_with_urls), _time.perf_counter() - _url_t0)

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
                    labels=node["labels"],
                    tier=tier,
                    course=Course(
                        title=node.get("course_title", ""),
                        url=node.get("course_url", ""),
                        reason=node.get("course_reason", ""),
                    ),
                    position=Position(x=x, y=y),
                )
            )
            all_skills.extend(node["labels"])

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
