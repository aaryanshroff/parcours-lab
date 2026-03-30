# Course Flow Design

How we model, display, and resolve university program requirements into a term-by-term course plan.

Current artifacts:
- `programs-NESTED2.json` is the current structured artifact with nested `groups`, named `lists`, term data for engineering, and preserved raw-text rules. Subject-code / range rules with no resolvable course list are stored as raw text.
- `programs-FLAT.json` is the older flat artifact with no nesting or named-list linkage
- `programs-NESTED.json` was an intermediate nested version that had a bug where subject-code filter rules (e.g. "Complete 3 from ACTSC, AMATH…") were classified as `rule: N` with empty courses instead of raw text

The current scraper preserves Kuali's nested HTML structure well enough for Chemistry-style grouped choices and CS-style named lists.

---

## 1. Scraping architecture

### Source

All program data comes from the Kuali API at `uwaterloocm.kuali.co/api/v1/catalog`.

- `GET /programs/{catalogId}` - list of all programs
- `GET /program/{catalogId}/{pid}` - full detail for one program, including two HTML fields:
  - `courseRequirementsNoUnits` - requirement groups for most programs
  - `requiredCoursesTermByTerm` - term-by-term HTML for engineering programs

### Script

`backend-v2/scripts/scrape-term-data.py`

Run with:

```bash
poetry run python scripts/scrape-term-data.py
poetry run python scripts/scrape-term-data.py --output data/programs-NESTED2.json
```

Default output: `backend-v2/data/programs-NESTED2.json`

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
  "lists": {
    "List 1": [...]
  },
  "termGroups": [...],
  "exclusions": [...]
}
```

- `requirementGroups` - top-level requirement groups; may contain nested `groups`
- `lists` - optional named reusable pools referenced by rules such as `"from List 1"`
- `termGroups` - term-by-term array for engineering programs
- `exclusions` - courses that cannot count toward the plan

### RequirementGroup shape

```json
{
  "rule": <value>,
  "courses": [
    { "code": "CS240", "title": "...", "units": 0.5 }
  ],
  "groups": [...],
  "credits": 3.0,
  "listRefs": ["List 1"]
}
```

- `groups` contains nested sub-groups when Kuali expresses a requirement as a tree
- `credits` is only present when `rule == "credits"`
- `listRefs` is only present when the rule text references a named list defined elsewhere in the HTML

### Rule values

| Value | Meaning |
|---|---|
| `"all"` | Complete every course in the list |
| `N` (int) | Complete exactly N courses / options from the list |
| `"credits"` | Complete N.N units from the list; see `credits` |
| raw string | Complex rule the parser could not classify cleanly |

Raw-text rules are left as-is. They may also have:
- no direct `courses`, when the rule points to subject codes, course ranges, breadth/depth requirements, or named lists
- nested `groups`, when the rule wraps child requirements
- `listRefs`, when the rule references a named list such as `"List 1"`

### TermGroup shape

```json
{
  "term": "1A Term",
  "requirementGroups": [ ... ]
}
```

Terms are named `"1A Term"`, `"1B Term"`, and so on.

---

## 3. How the HTML is parsed

### `courseRequirementsNoUnits`

Requirements usually appear as `li[data-test="ruleView-*"]` elements containing:
- a result `div[data-test="ruleView-*-result"]` with the rule header text and course list
- course items like `<li><a>COURSE_CODE</a> - Title (units)</li>` inside a nested list

Kuali also inserts anonymous wrapper `<li>` nodes like:
- `"Complete all of the following"`
- `"Complete 1 of the following"`

These wrappers matter when they group child rules, so the parser treats both `ruleView-*` nodes and wrapper LIs as potential requirement groups.

The parser now:
1. Extracts only the actual rule header text, without swallowing course-list text
2. Parses direct course links into the current group's `courses`
3. Recursively parses nested child groups into `groups`
4. Applies sibling-pair merging at each sibling level
5. Hoists exclusion groups into the program's top-level `exclusions`
6. Preserves raw text for unresolved rules, even when they have no direct course list

There is one intentional flattening step: if the entire section is wrapped in a single top-level `"Complete all of the following"` container with no direct courses, that wrapper is dropped and its children become the program's top-level `requirementGroups`. In practice that wrapper is structural chrome, not unique logic.

### Sibling-pair merging

Kuali sometimes expresses a requirement as two consecutive siblings:
- Rule `[i]`: a constraint with no courses, for example `"Complete 1.5 units from the following list"` -> `rule: "credits", credits: 1.5`
- Rule `[i+1]`: a pool, for example `"Choose any of the following"` -> internally tagged `_pool`

The parser merges these into a single group: the constraint rule plus the pool courses.

Standalone `_pool` groups with no preceding constraint become `rule: 1`.

This merge happens recursively, so the same pattern works inside nested Chemistry-style groups as well as top-level groups.

### Named lists

Some programs define separate sections such as `"List 1"` or `"Approved Courses List"` and reference them from the main requirements. The parser stores those sections in the program-level `lists` field instead of flattening their contents into `requirementGroups`.

Rules that reference named lists get `listRefs`, for example:

```json
{
  "rule": 1,
  "courses": [],
  "groups": [],
  "listRefs": ["List 1"]
}
```

### `requiredCoursesTermByTerm`

Engineering programs use `<section>` elements with `<h2 data-testid="grouping-label">1A Term</h2>` headings. The parser scopes each section independently so sibling-pair merging works within a term and emits `termGroups`.

---

## 4. Program taxonomy

### Type A - Fixed sequence

Engineering programs populate `termGroups`, while `requirementGroups` is empty.

Each term typically has:
- one `rule: "all"` group for locked courses
- zero or more `rule: N` groups for small choices
- some free elective slots that still appear only as prose in Kuali

The sequence is prescribed. Students cannot freely reorder required courses.

### Type B - Flexible sequence

Most non-engineering programs populate `requirementGroups` and have no term assignment.

Groups are a mix of:
- `rule: "all"` - hard required courses
- `rule: 1` small - equivalent alternatives such as `CS240` or `CS240E`
- `rule: 1` large - breadth / elective pools
- `rule: N` large - elective buckets
- `rule: "credits"` - unit-count requirements
- raw text - complex rules, unresolved constraints, or subject-code / range rules
- nested `groups` - bundled choices / OR-branches
- `listRefs` plus `lists` - named lists defined elsewhere in the same HTML

---

## 5. Resolving requirement groups into a plan

### Step 1 - Categorise each group by decision type

Auto-resolved:
- `rule: "all"` -> add every course directly to the plan
- `rule: 1` where the list size is small and the options are clear variants -> default to the standard variant
- wrapper groups whose children are all auto-resolved -> recursively resolve their children

Goal-resolved:
- `rule: 1` where the list is large
- `rule: N` where `N >= 2` and the list is large
- `rule: "credits"` -> convert credits to approximate course count and treat as `rule: N`
- `listRefs` -> resolve against the referenced named list(s)
- free elective slots in engineering

User-resolved:
- raw-text rules -> show the course list, named-list reference, or textual constraint and let the user choose
- `rule: 1` where courses are clearly non-equivalent and the goal context is ambiguous
- nested groups where the choice is between bundles rather than single courses
- any goal-resolved slot the user wants to override

### Step 2 - Assign terms for Type B programs

1. Build a prereq graph from course data
2. Map course code level to year: 100s -> year 1, 200s -> year 2, 300s -> year 3, 400s -> year 4
3. Use `max(prereq depth, code level)` to assign year
4. Within a year, split across terms
5. Show the user the result and allow adjustments

### Step 3 - Fill elective slots with goal-aware suggestions

For each unresolved slot:
- input: the user's goal, existing skills, and the eligible course pool
- output: ranked suggestions with a brief reason
- the user can accept the suggestion or browse the full pool

---

## 6. Data model for a resolved plan

```typescript
type TermSlot = {
  term: string
  courses: PlacedCourse[]
}

type PlacedCourse = {
  code: string
  title: string
  units: number
  status: "required" | "choice-resolved" | "elective-suggested" | "elective-user" | "placeholder"
  choicePoolId?: string
  lockedTerm: boolean
}

type ChoicePool = {
  id: string
  rule: number | "all" | "credits" | string
  credits?: number
  courses: Course[]
  groups: ChoicePool[]
  listRefs?: string[]
  resolved: string[]
  resolvedBy: "auto" | "goal" | "user"
}
```

---

## 7. Open questions

- Nested rules: much better than before, because the parser now preserves nested `groups` instead of flattening everything. Still, some nested branches are only partially resolvable because Kuali sometimes references external lists or prose inside the tree.
  `backend-v2/data/diagnostics/sample_html/chemistry.html` is the main example.
- Named lists: the scraper now stores these in `lists` and connects simple references through `listRefs`. What remains open is deeper semantic linkage when the wording is indirect, such as `"Approved Courses below"` rather than an exact list name.
  `backend-v2/data/diagnostics/sample_html/cs-bmath.html` is the main example for lists
- Subject-code / course-range rules: rules like `"Complete 2 additional CS courses chosen from CS440-CS489"` or `"Complete 3 additional courses from: ACTSC, AMATH, CO, PMATH, STAT"` are preserved as raw text, but we still need a downstream representation if we want to resolve them automatically.
- Breadth and depth requirements: still unresolved semantically. We preserve the raw rule text, but there is no structured model yet for breadth/depth categories.
- Double-counting: some courses satisfy multiple requirement slots. Do we track this?
- Transfer credits / already-completed courses: user marks courses as done -> removes them from the plan and may unlock later courses.
- Minor / specialization overlay: if the user adds a minor, its requirements inject into free elective slots. How do we show conflicts?
