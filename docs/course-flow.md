# Course Flow Design

How we model, display, and resolve university program requirements into a term-by-term course plan.
`programs.json` has term data for engineering, but lots of "unknown" rules
`programs-FLAT.json` has better unknown rule parsing (which adds a new "credits" rule), but is still a flat architecture
`programs copy.json` was the first version with no term data and "unknown" rules

Currently working on a scraper that can nest rules (claude is frustratingly bad at parsing the html structure, for some reason :( )

---

## 1. Scraping architecture

### Source

All program data comes from the **Kuali API** at `uwaterloocm.kuali.co/api/v1/catalog`.

- `GET /programs/{catalogId}` — list of all programs (477 total)
- `GET /program/{catalogId}/{pid}` — full detail for one program, including two HTML fields:
  - `courseRequirementsNoUnits` — requirement groups (used for all programs)
  - `requiredCoursesTermByTerm` — term-by-term HTML (engineering only)

### Script

`backend-v2/scripts/scrape-term-data.py`

Run with:
```
poetry run python scripts/scrape-term-data.py
poetry run python scripts/scrape-term-data.py --output data/programs.json
```

Output: `backend-v2/data/programs-FLAT.json` (466 programs)

---

## 2. Output data shape

Each program object:

```json
{
  "pid": "...",
  "code": "H-Computer Science (BMath)",
  "title": "Computer Science (Bachelor of Mathematics - Honours)",
  "credentialType": "Bachelor of Mathematics",
  "faculty": "Mathematics",
  "fieldOfStudy": "Computer Science",
  "requirementGroups": [...],
  "termGroups": [...],
  "exclusions": [...]
}
```

- `requirementGroups` — flat array of requirement rules (all programs)
- `termGroups` — term-by-term array (engineering only, 14 programs); when present, `requirementGroups` is empty
- `exclusions` — courses that cannot count toward this plan (19 programs have this)

### RequirementGroup shape

```json
{
  "rule": <value>,
  "courses": [ { "code": "CS240", "title": "...", "units": 0.5 }, ... ],
  "groups": [],
  "credits": 3.0
}
```

`groups` is reserved for nested sub-groups (currently always `[]` — nesting not yet implemented).

`credits` only present when `rule == "credits"`.

### Rule values

| Value | Meaning | Count |
|---|---|---|
| `"all"` | Complete every course in the list | 526 |
| `N` (int) | Complete exactly N from the list | 1157 total (883 are `1`, 118 are `2`, etc.) |
| `"credits"` | Complete N.N units from the list — see `credits` field | 24 |
| raw string | Complex rule the parser couldn't classify cleanly | 13 distinct patterns, ~13 programs |

Raw-text rules are left as-is (the full Kuali header text). Examples: `"The remaining 3 courses can be from List 1 or 2."`, `"Complete 4.0 additional units of GSJ courses or from the following list"`. These have a valid `courses` list — only the pick-count is ambiguous.

### TermGroup shape (engineering)

```json
{
  "term": "1A Term",
  "requirementGroups": [ ... ]
}
```

Terms are named `"1A Term"`, `"1B Term"`, ... `"4B Term"`.

---

## 3. How the HTML is parsed

### `courseRequirementsNoUnits`

Requirements appear as `<li data-test="ruleView-A">` elements containing:
- A result `<div data-test="ruleView-A-result">` with the rule header text and course list
- Course items as `<li><a>COURSE_CODE</a> - Title (units)</li>` inside a `<ul>`

The parser (`parse_requirement_groups_from_soup`) finds all `ruleView-*` LIs in document order and:
1. Extracts the rule header text and classifies it (see rule values above)
2. Extracts course `<a>` tags as the course list
3. Applies sibling-pair merging (see below)
4. Strips exclusion groups into the top-level `exclusions` field

### Sibling-pair merging ("Choose any" + constraint)

Kuali sometimes splits a requirement into two consecutive rules:
- Rule [i]: constraint text with no courses — e.g. `"Complete 1.5 units from the following list"` → `rule: "credits", credits: 1.5`
- Rule [i+1]: pool — `"Choose any of the following: COURSE_A, COURSE_B, ..."` → internally tagged `_pool`

The parser merges these into a single group: constraint rule + pool courses.

Standalone `_pool` rules (no preceding constraint) become `rule: 1`.

### `requiredCoursesTermByTerm`

Engineering programs use `<section>` elements with `<h2 data-testid="grouping-label">1A Term</h2>` headings. The parser scopes each section independently (so sibling-pair merging works within a term) and emits `termGroups`.

---

## 4. Program taxonomy

### Type A — Fixed sequence (Engineering, 14 programs)

SE, ECE, Mech, Civil, etc. `termGroups` is populated, `requirementGroups` is empty.

Each term typically has:
- One `rule: "all"` group (the locked courses)
- Zero or more `rule: N` groups (small choices, e.g. pick your physics stream)
- Free elective slots appear as text prose in Kuali — not in the structured data

The sequence is prescribed. Students cannot reorder required courses.

### Type B — Flexible sequence (CS, Math, Arts/Science, 361 programs)

`requirementGroups` is populated, no term assignment. Groups are a mix of:
- `rule: "all"` — hard required courses
- `rule: 1` small — equivalent alternatives (CS240 or CS240E)
- `rule: 1` large — breadth/elective pools
- `rule: N` large — elective buckets (pick 3 from 20 AI courses)
- `rule: "credits"` — unit-count requirements (complete 3.0 units from this list)
- raw text — complex rules, treat as optional pools

---

## 5. Resolving requirement groups into a plan

### Step 1 — Categorise each group by decision type

**Auto-resolved** — no user input needed:
- `rule: "all"` → add every course directly to plan
- `rule: 1` where list size ≤ 3 AND courses are clearly equivalent variants (e.g. CS240/CS240E) → default to standard variant

**Goal-resolved** — LLM picks based on user's stated goal/career direction:
- `rule: 1` where list size > 3 — large elective pools
- `rule: N` where N ≥ 2 and list is large — elective buckets
- `rule: "credits"` — convert credits to approximate course count (÷ 0.5), treat as `rule: N`
- Free elective slots in engineering

**User-resolved** — surface as explicit choices:
- Raw-text rules — show course list, let user select
- `rule: 1` where courses are clearly non-equivalent and goal context is ambiguous
- Any goal-resolved slot the user wants to override

### Step 2 — Assign terms (Type B programs only)

1. Build prereq graph (from `uwaterloo.py` course data)
2. Map course code level to year: 100s → year 1, 200s → year 2, 300s → year 3, 400s → year 4
3. Use max(prereq depth, code level) to assign year
4. Within a year, split across terms (~5 courses each at UW)
5. Show user the result — they can drag courses between terms

Co-op work terms don't affect the study term sequence — the 1A/1B/2A/2B structure is fixed. Co-op just inserts work terms between study terms; the course content per study term is unchanged.

### Step 3 — Fill elective slots with goal-aware suggestions

For each unresolved slot:
- Input: user's goal, existing skills, eligible course pool
- Output: ranked suggestions with a one-sentence reason each
- User can accept the suggestion or browse the full pool

---

## 6. Data model for a resolved plan (proposed)

```typescript
type TermSlot = {
  term: string            // "1A", "1B", "2A", etc.
  courses: PlacedCourse[]
}

type PlacedCourse = {
  code: string
  title: string
  units: number
  status: "required" | "choice-resolved" | "elective-suggested" | "elective-user" | "placeholder"
  choicePoolId?: string   // links back to the requirementGroup it came from
  lockedTerm: boolean     // true for engineering fixed courses
}

type ChoicePool = {
  id: string
  rule: number | "all" | "credits" | string
  credits?: number        // present when rule == "credits"
  courses: Course[]
  resolved: string[]      // codes the user/LLM picked
  resolvedBy: "auto" | "goal" | "user"
}
```

---

## 7. Open questions

- **Nested rules**: Some Kuali programs express "pick from list A OR list B" as nested ruleView elements in the DOM (dotted IDs like `ruleView-C.1`, `ruleView-C.2`). The current parser flattens these — sibling-pair merging handles most cases, but complex nesting (3+ levels) is not yet supported. The `groups` field is reserved for this.
  - `data/diagnostics/chemistry.html` is provided as an example of html with heavy nesting
- **Named lists ("List 1", "List 2")**: Some programs define named course lists in a separate section and reference them in rules — e.g. "Complete 3 courses from List 1 or List 2" where List 1 and List 2 are defined elsewhere in the HTML. The current scraper doesn't model this relationship; the constraint rule and the list contents end up as unconnected flat groups. A potential fix would be a `lists` field on the program that maps list names to course arrays, referenced by rules. Left as an open question for now.
  - `data/diagnostics/cs.html` is provided as an example of html with lists to choose from (also, another open question involving this: how in the heck do we encode breadth and depth requirements?? why are my grad requirements so complicated??)
- **Double-counting**: Some courses satisfy multiple requirement slots. Do we track this?
- **Transfer credits / already-completed courses**: User marks courses as done → removes from plan, may unlock later courses.
- **Minor/specialization overlay**: If user adds a minor, its requirements inject into free elective slots. How do we show conflicts?
