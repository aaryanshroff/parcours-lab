import os
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

load_dotenv()

app = Flask(__name__)
CORS(app)


@app.route("/api/health")
def health():
    return {"status": "ok"}


@app.route("/api/graph", methods=["POST"])
def graph():
    from graph_generator import generate_learning_path

    body = request.get_json() or {}
    goal = body.get("goal", "")
    existing_skills = body.get("existing_skills", [])
    desired_skills = body.get("desired_skills", [])

    api_key = os.environ["OPENROUTER_API_KEY"]
    result = generate_learning_path(goal, existing_skills, desired_skills, api_key)
    return jsonify(result.model_dump())


@app.route("/api/resume/skills", methods=["POST"])
def resume_skills():
    from resume_parser import extract_text, extract_skills, match_esco_skills

    file = request.files.get("resume")
    if not file:
        return jsonify({"error": "No resume file provided"}), 400

    api_key = os.environ["OPENROUTER_API_KEY"]
    text = extract_text(file)
    raw_skills = extract_skills(text, api_key)
    skills = match_esco_skills(raw_skills, api_key)
    return jsonify({"skills": skills})


@app.route("/api/goal/skills", methods=["POST"])
def goal_skills():
    from resume_parser import extract_goal_skills, match_esco_skills

    body = request.get_json() or {}
    goal = body.get("goal", "")
    if not goal.strip():
        return jsonify({"skills": []})

    api_key = os.environ["OPENROUTER_API_KEY"]
    raw = extract_goal_skills(goal, api_key)
    all_raw = raw["existing"] + raw["desired"]
    matched = match_esco_skills(all_raw, api_key) if all_raw else []
    # Split back into existing/desired
    n_existing = len(raw["existing"])
    return jsonify({
        "existing": matched[:n_existing],
        "desired": matched[n_existing:],
    })


@app.route("/api/job/skills", methods=["POST"])
def job_skills():
    from job_parser import fetch_job_posting, extract_job_skills
    from resume_parser import match_esco_skills

    body = request.get_json() or {}
    url = body.get("url", "")
    if not url.strip():
        return jsonify({"skills": []})

    api_key = os.environ["OPENROUTER_API_KEY"]
    text = fetch_job_posting(url)
    raw_skills = extract_job_skills(text, api_key)
    skills = match_esco_skills(raw_skills, api_key)
    return jsonify({"skills": skills})


@app.route("/api/graph/academics", methods=["POST"])
def graph_academics():
    from academic_graph import generate_academic_graph

    body = request.get_json() or {}
    requirement_groups = body.get("requirement_groups", [])
    specialization_pids = body.get("specialization_pids", [])
    minor_pids = body.get("minor_pids", [])
    goal = body.get("goal", "")

    app.logger.info(
        "[academics] request groups=%d specs=%d minors=%d goal_len=%d",
        len(requirement_groups),
        len(specialization_pids),
        len(minor_pids),
        len(goal or ""),
    )
    app.logger.info(
        "[academics] groups with courses=%d elective_type=%d",
        sum(1 for g in requirement_groups if g.get("courses")),
        sum(1 for g in requirement_groups if g.get("elective_type")),
    )

    api_key = os.environ["OPENROUTER_API_KEY"]
    result = generate_academic_graph(
        requirement_groups, specialization_pids, minor_pids, goal, api_key
    )
    elective_nodes = [
        n for n in result.nodes
        if getattr(n.course, "reason", "") != "Required course"
    ]
    terms = sorted({getattr(n, "term", "") for n in result.nodes if getattr(n, "term", "")})
    app.logger.info(
        "[academics] result nodes=%d electives=%d terms=%s",
        len(result.nodes),
        len(elective_nodes),
        ",".join(terms),
    )
    return jsonify(result.model_dump())


@app.route("/api/summary/generate", methods=["POST"])
def summary_generate():
    from openai import OpenAI

    body = request.get_json() or {}
    goal = body.get("goal", "")
    mode = body.get("mode", "career")
    program = body.get("program")
    nodes = body.get("nodes", [])

    if not nodes:
        return jsonify({"summary": "No courses to summarize."})

    is_academic = mode == "academics"
    group_key = "term" if is_academic else "tier"
    order = (
        ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"]
        if is_academic
        else ["foundation", "core", "advanced", "specialization"]
    )

    groups: dict[str, list[dict]] = {}
    for node in nodes:
        key = node.get(group_key, "other")
        groups.setdefault(key, []).append(node)

    course_desc = []
    for key in order:
        items = groups.get(key)
        if not items:
            continue
        label = f"Term {key}" if is_academic else key.capitalize()
        course_desc.append(f"\n{label}:")
        for n in items:
            reason = n.get("courseReason") or n.get("course_reason", "")
            skills = ", ".join(n.get("labels", []))
            course_desc.append(
                f"  - {n.get('courseTitle', n.get('course_title', ''))}"
                + (f" [{skills}]" if skills else "")
                + (f": {reason}" if reason else "")
            )

    context_header = ""
    if is_academic and program:
        context_header = f"Program: {program.get('title', '')} ({program.get('faculty', '')})\n"
    if goal:
        context_header += f"Goal: {goal}\n"

    prompt = context_header + "\nCourses:\n" + "\n".join(course_desc)

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ["OPENROUTER_API_KEY"],
    )

    if is_academic:
        system_content = (
            "You are an academic advisor writing a concise summary of a student's "
            "course plan. Write 1–3 paragraphs that:\n"
            "1. Describe the overall structure and progression across terms\n"
            "2. Highlight key required courses and how elective choices connect to the student's goal\n"
            "3. Note the balance of workload across terms objectively for accurate assessment of required student effort\n\n"
            "Be specific — reference actual course names. Keep it under 250 words. "
            "Do NOT use observational language like \"appears to be, looks, or seems to\"."
            "Do NOT use language indicating this is a third party assessment of the courses - Use direct descriptions."
            "Do NOT use markdown formatting, bullet points, or headers — write in plain prose paragraphs."
            # maybe have some explicit guidelines here later for advisors
        )
    else:
        system_content = (
            "You are a learning path advisor writing a concise summary of a personalized skill-building "
            "roadmap. Write 2–4 paragraphs that:\n"
            "1. Explain the learning progression from foundational to specialized skills\n"
            "2. Highlight why specific courses were chosen and how they connect to the goal\n"
            "3. Describe how the skills build on each other\n"
            "4. Offer a brief, encouraging closing remark\n\n"
            "Be specific — reference actual course names and skills. Keep it under 250 words. "
            "Do NOT use markdown formatting, bullet points, or headers — write in plain prose paragraphs."
        )

    response = client.chat.completions.create(
        model="google/gemini-2.5-flash",
        messages=[
            {"role": "system", "content": system_content},
            {"role": "user", "content": prompt},
        ],
        temperature=0.4,
    )

    summary_text = (response.choices[0].message.content or "").strip()
    return jsonify({"summary": summary_text})


@app.route("/api/uwaterloo/programs")
def uwaterloo_programs():
    from uwaterloo import search_programs

    q = request.args.get("q", "").strip()
    credential_type = request.args.get("type")
    field_of_study = request.args.get("fieldOfStudy")

    if not q and not credential_type and not field_of_study:
        return jsonify({"programs": []})

    programs = search_programs(q, credential_type, field_of_study)
    return jsonify({"programs": programs})


@app.route("/api/uwaterloo/programs/<pid>/requirements")
def uwaterloo_requirements(pid):
    from uwaterloo import get_program

    program = get_program(pid)
    if not program:
        return jsonify({"error": "Program not found"}), 404
    return jsonify(program)


@app.route("/api/uwaterloo/courses/<code>/prereqs")
def uwaterloo_course_prereqs(code):
    from uwaterloo import get_course_prereqs

    result = get_course_prereqs(code)
    if not result:
        return jsonify({"error": "Course not found"}), 404
    return jsonify(result)


@app.route("/api/esco/search")
def esco_search():
    from resume_parser import _fetch_esco_candidates

    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"results": []})

    candidates = _fetch_esco_candidates(q, limit=10)
    return jsonify({"results": candidates})


@app.route("/api/course/replace", methods=["POST"])
def course_replace():
    import json as _json
    from openai import OpenAI

    body = request.get_json() or {}
    skill = body.get("skill", "")
    current_course = body.get("current_course", "")
    reason = body.get("reason", "")

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ["OPENROUTER_API_KEY"],
    )

    prompt = (
        f"The user is learning the skill: \"{skill}\".\n"
        f"They were recommended the course: \"{current_course}\", but want a replacement."
    )
    if reason:
        prompt += f"\nTheir reason: \"{reason}\""
    prompt += (
        "\n\nSuggest ONE alternative online course for this exact skill. "
        "Return JSON only: {\"title\": \"<course title> — <platform>\", \"url\": \"<course url>\", \"reason\": \"<one sentence explaining why this course is a better fit>\"}"
    )

    response = client.chat.completions.create(
        model="openai/gpt-4.1-mini",
        messages=[
            {"role": "system", "content": "You recommend online courses. Reply with valid JSON only, no markdown."},
            {"role": "user", "content": prompt},
        ],
    )

    course = _json.loads(response.choices[0].message.content)
    return jsonify({"course": course})


CHAT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "replace_course",
            "description": "Replace the recommended course for a skill in the learning path with a different one.",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_name": {"type": "string", "description": "The exact skill label to replace the course for"},
                    "reason": {"type": "string", "description": "Why the user wants a different course"},
                },
                "required": ["skill_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_my_skill",
            "description": "Add a skill to the user's existing skills (My Skills).",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_name": {"type": "string", "description": "The skill to add"},
                },
                "required": ["skill_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_my_skill",
            "description": "Remove a skill from the user's existing skills (My Skills).",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_name": {"type": "string", "description": "The exact skill label to remove"},
                },
                "required": ["skill_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_desired_skill",
            "description": "Add a skill to the desired skills (skills the user needs to learn).",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_name": {"type": "string", "description": "The skill to add"},
                },
                "required": ["skill_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_desired_skill",
            "description": "Remove a skill from the desired skills.",
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_name": {"type": "string", "description": "The exact skill label to remove"},
                },
                "required": ["skill_name"],
            },
        },
    },
]


def _execute_chat_tool(name: str, args: dict, api_key: str, context: dict | None = None) -> tuple[str, dict]:
    """Execute a tool call. Returns (result_text, action_dict)."""
    import json as _json
    import re as _re

    if name == "replace_course":
        from openai import OpenAI

        skill = args.get("skill_name", "")
        reason = args.get("reason", "")
        current_course = args.get("current_course", "")
        ctx = context or {}

        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)

        if ctx.get("mode") == "academics":
            from uwaterloo import list_courses_by_subject, get_course_prereqs

            subject_match = _re.match(r"^([A-Z]{2,})", skill.strip().upper())
            subject = subject_match.group(1) if subject_match else ""
            candidates = []
            if subject:
                norm_current = skill.replace(" ", "").upper()
                candidates = [
                    c for c in list_courses_by_subject(subject)
                    if c["code"].replace(" ", "").upper() != norm_current
                ]

            if candidates:
                # Build set of course codes in the user's plan (excluding the one being replaced)
                plan_codes: set[str] = set()
                for node in ctx.get("nodes", []):
                    node_skill = node.get("skill", "") if isinstance(node, dict) else ""
                    for part in node_skill.split(","):
                        c = part.strip().replace(" ", "").upper()
                        if c and c != norm_current:
                            plan_codes.add(c)

                # Filter candidates to those whose prereqs are all satisfied by the plan
                prereq_filtered = []
                for candidate in candidates:
                    prereq_data = get_course_prereqs(candidate["code"])
                    if prereq_data is None:
                        prereq_filtered.append(candidate)
                        continue
                    prereqs = prereq_data.get("prereqs", [])
                    if all(p.replace(" ", "").upper() in plan_codes for p in prereqs):
                        prereq_filtered.append(candidate)

                if prereq_filtered:
                    candidates = prereq_filtered
                goal = ctx.get("goal", "")
                course_list = "\n".join(f"- {c['code']}: {c['title']}" for c in candidates[:40])
                prompt = f'The user is studying at University of Waterloo{" towards: " + goal if goal else ""}.\n'
                prompt += f'They want to replace the course "{skill}" ({current_course or "current course"}).'
                if reason:
                    prompt += f'\nReason: "{reason}"'
                prompt += f"\n\nChoose ONE replacement from this list:\n{course_list}\n\nReturn JSON only: {{\"code\": \"<course code>\", \"title\": \"<course title>\", \"reason\": \"<one sentence why it's a good fit>\"}}"

                resp = client.chat.completions.create(
                    model="openai/gpt-4.1-mini",
                    messages=[
                        {"role": "system", "content": "You recommend University of Waterloo courses. Reply with valid JSON only, no markdown."},
                        {"role": "user", "content": prompt},
                    ],
                )
                picked = _json.loads(resp.choices[0].message.content)
                code = picked.get("code", skill)
                title = picked.get("title", code)
                course = {
                    "title": f"{code}: {title}",
                    "url": f"https://uwflow.com/course/{code.replace(' ', '').lower()}",
                    "reason": picked.get("reason", ""),
                }
            else:
                course = {
                    "title": skill,
                    "url": f"https://uwflow.com/course/{skill.replace(' ', '').lower()}",
                    "reason": "No alternative found in the same subject.",
                }
        else:
            prompt = f'The user is learning the skill: "{skill}".'
            if current_course:
                prompt += f' They were recommended the course: "{current_course}", but want a replacement.'
            if reason:
                prompt += f' Their reason: "{reason}"'
            prompt += '\n\nSuggest ONE alternative online course for this exact skill. Return JSON only: {"title": "<course title> — <platform>", "url": "<course url>", "reason": "<one sentence explaining why this course is a better fit>"}'

            resp = client.chat.completions.create(
                model="openai/gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": "You recommend online courses. Reply with valid JSON only, no markdown."},
                    {"role": "user", "content": prompt},
                ],
            )
            course = _json.loads(resp.choices[0].message.content)

        return (
            f"Replaced course for {skill} with: {course['title']}",
            {"type": "replace_course", "skill_name": skill, "course": course},
        )

    if name in ("add_my_skill", "remove_my_skill", "add_desired_skill", "remove_desired_skill"):
        skill = args.get("skill_name", "")
        return (
            f"Done: {name.replace('_', ' ')} '{skill}'",
            {"type": name, "skill_name": skill},
        )

    return ("Unknown tool", {})


@app.route("/api/chat", methods=["POST"])
def chat():
    import json as _json
    from openai import OpenAI

    body = request.get_json() or {}
    messages = body.get("messages", [])
    context = body.get("context", {})

    api_key = os.environ["OPENROUTER_API_KEY"]
    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)

    if context.get("mode") == "academics":
        system_content = (
            "You are a helpful academic advisor embedded in a University of Waterloo course planner. "
            "You help students understand their course plan, suggest study strategies, "
            "and answer questions about the courses in their plan. "
            "You can modify the user's course plan using tools. "
            "When replacing a course, use the replace_course tool with the course code (e.g. 'CS 135') as skill_name. "
            "Keep responses concise and friendly. "
            "If the user's message is not about course planning, academics, or university life, "
            "respond ONLY with: \"I'm here to help with your course plan. "
            "What would you like to change?\""
        )
    else:
        system_content = (
            "You are a helpful learning path assistant embedded in a skill-tree app. "
            "You help users understand their personalized learning path, suggest study strategies, "
            "and answer questions about the skills and courses in their tree. "
            "You can modify the user's skill tree using tools. "
            "Keep responses concise and friendly. "
            "If the user's message is not about learning paths, courses, goals, skills, or career development, "
            "respond ONLY with: \"I'm here to help with your learning path and course recommendations. "
            "What skills or goals are you working toward?\""
        )
    if context:
        system_content += "\n\nCurrent state of the user's learning path:\n" + _json.dumps(context)

    api_messages = [{"role": "system", "content": system_content}, *messages]
    actions = []

    academic_mode = context.get("mode") == "academics"
    tools = [t for t in CHAT_TOOLS if t["function"]["name"] == "replace_course"] if academic_mode else CHAT_TOOLS

    # Tool calling loop (max 5 iterations)
    for _ in range(5):
        response = client.chat.completions.create(
            model="openai/gpt-4.1-mini",
            messages=api_messages,
            tools=tools,
        )
        choice = response.choices[0]

        if choice.finish_reason == "tool_calls" or choice.message.tool_calls:
            # Append assistant message with tool calls
            api_messages.append(choice.message)

            for tool_call in choice.message.tool_calls:
                args = _json.loads(tool_call.function.arguments)
                result_text, action = _execute_chat_tool(tool_call.function.name, args, api_key, context)
                if action:
                    actions.append(action)
                api_messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result_text,
                })
        else:
            return jsonify({"message": choice.message.content, "actions": actions})

    # Fallback if loop exhausted
    return jsonify({"message": "I've made the changes to your learning path!", "actions": actions})


if __name__ == "__main__":
    host = os.getenv("FLASK_RUN_HOST", "127.0.0.1")
    port = int(os.getenv("FLASK_RUN_PORT", "5001"))
    app.run(host=host, port=port, debug=True)
