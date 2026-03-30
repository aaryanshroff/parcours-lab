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

    api_key = os.environ["OPENROUTER_API_KEY"]
    result = generate_academic_graph(
        requirement_groups, specialization_pids, minor_pids, goal, api_key
    )
    return jsonify(result.model_dump())


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


def _execute_chat_tool(name: str, args: dict, api_key: str) -> tuple[str, dict]:
    """Execute a tool call. Returns (result_text, action_dict)."""
    import json as _json

    if name == "replace_course":
        from openai import OpenAI

        skill = args.get("skill_name", "")
        reason = args.get("reason", "")
        current_course = args.get("current_course", "")

        client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)
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

    # Tool calling loop (max 5 iterations)
    for _ in range(5):
        response = client.chat.completions.create(
            model="openai/gpt-4.1-mini",
            messages=api_messages,
            tools=CHAT_TOOLS,
        )
        choice = response.choices[0]

        if choice.finish_reason == "tool_calls" or choice.message.tool_calls:
            # Append assistant message with tool calls
            api_messages.append(choice.message)

            for tool_call in choice.message.tool_calls:
                args = _json.loads(tool_call.function.arguments)
                result_text, action = _execute_chat_tool(tool_call.function.name, args, api_key)
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
