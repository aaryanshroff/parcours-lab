import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Search, Loader2, X, ChevronRight, Plus } from 'lucide-react'

interface Program {
  pid: string
  title: string
  credentialType: string
  faculty: string
  fieldOfStudy: string
}

interface Course {
  code: string
  title: string
  units: number | null
}

interface RequirementGroup {
  rule: 'all' | number | 'unknown'
  courses: Course[]
}

interface ProgramDetail extends Program {
  requirementGroups: RequirementGroup[]
}

export default function AcademicsForm() {
  const navigate = useNavigate()

  // Major
  const [majorQuery, setMajorQuery] = useState('')
  const [majorResults, setMajorResults] = useState<Program[]>([])
  const [searchingMajor, setSearchingMajor] = useState(false)
  const [selectedMajor, setSelectedMajor] = useState<Program | null>(null)
  const [majorDetail, setMajorDetail] = useState<ProgramDetail | null>(null)
  const [loadingMajorDetail, setLoadingMajorDetail] = useState(false)
  const majorAbortRef = useRef<AbortController | null>(null)

  // Specializations
  const [availableSpecs, setAvailableSpecs] = useState<Program[]>([])
  const [selectedSpecs, setSelectedSpecs] = useState<Program[]>([])

  // Minors
  const [minorQuery, setMinorQuery] = useState('')
  const [minorResults, setMinorResults] = useState<Program[]>([])
  const [searchingMinor, setSearchingMinor] = useState(false)
  const [selectedMinors, setSelectedMinors] = useState<Program[]>([])
  const minorAbortRef = useRef<AbortController | null>(null)

  // Goal
  const [goal, setGoal] = useState('')

  // Search majors
  useEffect(() => {
    const trimmed = majorQuery.trim()
    if (trimmed.length < 2) {
      setMajorResults([])
      setSearchingMajor(false)
      return
    }

    setSearchingMajor(true)
    const timer = setTimeout(() => {
      majorAbortRef.current?.abort()
      const controller = new AbortController()
      majorAbortRef.current = controller

      fetch(`/api/uwaterloo/programs?q=${encodeURIComponent(trimmed)}&type=Major`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => setMajorResults(data.programs ?? []))
        .catch((e) => { if (e.name !== 'AbortError') console.error(e) })
        .finally(() => setSearchingMajor(false))
    }, 300)

    return () => {
      clearTimeout(timer)
      majorAbortRef.current?.abort()
    }
  }, [majorQuery])

  // Fetch major detail + specializations when major selected
  useEffect(() => {
    if (!selectedMajor) {
      setMajorDetail(null)
      setAvailableSpecs([])
      setSelectedSpecs([])
      return
    }

    setLoadingMajorDetail(true)
    const controller = new AbortController()

    // Fetch detail and specializations in parallel
    const detailFetch = fetch(
      `/api/uwaterloo/programs/${encodeURIComponent(selectedMajor.pid)}/requirements`,
      { signal: controller.signal },
    ).then((r) => r.json())

    const specsFetch = fetch(
      `/api/uwaterloo/programs?type=Specialization&fieldOfStudy=${encodeURIComponent(selectedMajor.fieldOfStudy)}`,
      { signal: controller.signal },
    ).then((r) => r.json())

    Promise.all([detailFetch, specsFetch])
      .then(([detail, specs]) => {
        setMajorDetail(detail)
        setAvailableSpecs(specs.programs ?? [])
      })
      .catch((e) => { if (e.name !== 'AbortError') console.error(e) })
      .finally(() => setLoadingMajorDetail(false))

    return () => controller.abort()
  }, [selectedMajor])

  // Search minors
  useEffect(() => {
    const trimmed = minorQuery.trim()
    if (trimmed.length < 2) {
      setMinorResults([])
      setSearchingMinor(false)
      return
    }

    setSearchingMinor(true)
    const timer = setTimeout(() => {
      minorAbortRef.current?.abort()
      const controller = new AbortController()
      minorAbortRef.current = controller

      fetch(`/api/uwaterloo/programs?q=${encodeURIComponent(trimmed)}&type=Minor`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => setMinorResults(data.programs ?? []))
        .catch((e) => { if (e.name !== 'AbortError') console.error(e) })
        .finally(() => setSearchingMinor(false))
    }, 300)

    return () => {
      clearTimeout(timer)
      minorAbortRef.current?.abort()
    }
  }, [minorQuery])

  function selectMajor(program: Program) {
    setSelectedMajor(program)
    setMajorQuery('')
    setMajorResults([])
  }

  function clearMajor() {
    setSelectedMajor(null)
    setMajorDetail(null)
    setAvailableSpecs([])
    setSelectedSpecs([])
  }

  function toggleSpec(spec: Program) {
    setSelectedSpecs((prev) =>
      prev.some((s) => s.pid === spec.pid)
        ? prev.filter((s) => s.pid !== spec.pid)
        : [...prev, spec],
    )
  }

  function addMinor(minor: Program) {
    if (!selectedMinors.some((m) => m.pid === minor.pid)) {
      setSelectedMinors((prev) => [...prev, minor])
    }
    setMinorQuery('')
    setMinorResults([])
  }

  function removeMinor(pid: string) {
    setSelectedMinors((prev) => prev.filter((m) => m.pid !== pid))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedMajor || !majorDetail) return
    navigate('/graph', {
      state: {
        mode: 'academics',
        major: selectedMajor,
        requirementGroups: majorDetail.requirementGroups,
        specializations: selectedSpecs,
        minors: selectedMinors,
        goal,
      },
    })
  }

  function ruleLabel(rule: RequirementGroup['rule']): string {
    if (rule === 'all') return 'Complete all'
    if (typeof rule === 'number') return `Pick ${rule}`
    return ''
  }

  const canSubmit = !!selectedMajor && !!majorDetail && !loadingMajorDetail

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      {/* 1. Major search */}
      <div>
        <label htmlFor="major-search" className="block text-sm font-semibold text-stone-700 mb-2">
          Your major
        </label>

        {selectedMajor ? (
          <div className="flex items-center gap-3 px-4 py-3 border border-stone-200 rounded-xl bg-stone-50">
            <div className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-stone-800">{selectedMajor.title}</span>
              <span className="block text-xs text-stone-500">{selectedMajor.faculty}</span>
            </div>
            <button
              type="button"
              onClick={clearMajor}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200 cursor-pointer transition-colors duration-150"
              aria-label="Change major"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="relative">
            <div className="flex items-center border border-stone-200 rounded-xl overflow-hidden focus-within:border-blue-800 focus-within:ring-2 focus-within:ring-blue-900/15 transition-all duration-150">
              <div className="pl-4 pr-2 text-stone-400">
                {searchingMajor ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              </div>
              <input
                id="major-search"
                type="text"
                value={majorQuery}
                onChange={(e) => setMajorQuery(e.target.value)}
                placeholder="Search majors (e.g. Computer Science, Accounting)..."
                className="flex-1 px-2 py-3 text-sm text-stone-800 outline-none bg-transparent placeholder:text-stone-400"
              />
            </div>

            {majorResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {majorResults.map((program) => (
                  <button
                    key={program.pid}
                    type="button"
                    onClick={() => selectMajor(program)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 cursor-pointer transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-stone-800">{program.title}</span>
                      <span className="block text-xs text-stone-500">{program.faculty}</span>
                    </div>
                    <ChevronRight size={14} className="text-stone-300 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Loading */}
      {loadingMajorDetail && (
        <div className="flex items-center gap-2 text-sm text-stone-500">
          <Loader2 size={14} className="animate-spin" />
          Loading program requirements...
        </div>
      )}

      {/* 2. Major requirement groups */}
      {majorDetail && majorDetail.requirementGroups.length > 0 && (
        <div className="space-y-3">
          {majorDetail.requirementGroups.map((group, i) => (
            <div key={i}>
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                {ruleLabel(group.rule)} ({group.courses.length})
              </span>
              <div className="flex flex-wrap gap-1.5">
                {group.courses.map((course) => (
                  <span
                    key={course.code}
                    className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full ${
                      group.rule === 'all'
                        ? 'bg-blue-50 text-blue-900'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                    title={course.title}
                  >
                    {course.code}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3. Specializations */}
      {majorDetail && availableSpecs.length > 0 && (
        <div>
          <span className="block text-sm font-semibold text-stone-700 mb-2">
            Specializations
          </span>
          <div className="flex flex-wrap gap-1.5">
            {availableSpecs.map((spec) => {
              const selected = selectedSpecs.some((s) => s.pid === spec.pid)
              return (
                <button
                  key={spec.pid}
                  type="button"
                  onClick={() => toggleSpec(spec)}
                  className={`inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-full border cursor-pointer transition-all duration-150 ${
                    selected
                      ? 'bg-violet-50 border-violet-300 text-violet-700'
                      : 'bg-white border-stone-200 text-stone-600 hover:border-violet-300 hover:text-violet-700'
                  }`}
                >
                  {spec.title}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 4. Minors */}
      {majorDetail && (
        <div>
          <span className="block text-sm font-semibold text-stone-700 mb-2">
            Minors <span className="font-normal text-stone-400">(optional)</span>
          </span>

          {/* Selected minors */}
          {selectedMinors.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedMinors.map((minor) => (
                <span
                  key={minor.pid}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700"
                >
                  {minor.title}
                  <button
                    type="button"
                    onClick={() => removeMinor(minor.pid)}
                    className="p-0.5 -mr-1 rounded-full text-emerald-400 hover:text-emerald-700 hover:bg-emerald-200 cursor-pointer transition-all duration-150"
                    aria-label={`Remove ${minor.title}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Minor search */}
          <div className="relative">
            <div className="flex items-center border border-stone-200 rounded-xl overflow-hidden focus-within:border-blue-800 focus-within:ring-2 focus-within:ring-blue-900/15 transition-all duration-150">
              <div className="pl-4 pr-2 text-stone-400">
                {searchingMinor ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              </div>
              <input
                type="text"
                value={minorQuery}
                onChange={(e) => setMinorQuery(e.target.value)}
                placeholder="Search minors..."
                className="flex-1 px-2 py-2.5 text-sm text-stone-800 outline-none bg-transparent placeholder:text-stone-400"
              />
            </div>

            {minorResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {minorResults
                  .filter((m) => !selectedMinors.some((s) => s.pid === m.pid))
                  .map((minor) => (
                    <button
                      key={minor.pid}
                      type="button"
                      onClick={() => addMinor(minor)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-stone-50 cursor-pointer transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl"
                    >
                      <span className="text-sm font-medium text-stone-800">{minor.title}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. Goal */}
      {majorDetail && (
        <div>
          <label htmlFor="academics-goal" className="block text-sm font-semibold text-stone-700 mb-2">
            What are you interested in?
          </label>
          <textarea
            id="academics-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. I'm interested in machine learning and want to work in AI research..."
            rows={3}
            className="w-full border border-stone-200 rounded-xl px-4 py-3 text-stone-800 text-base leading-relaxed outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-900/15 resize-none transition-all duration-150 placeholder:text-stone-400"
          />
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-blue-900 text-white hover:bg-blue-950 shadow-sm hover:shadow-md"
      >
        {loadingMajorDetail ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Loading requirements...
          </>
        ) : (
          <>
            Plan my courses
            <ArrowRight size={16} />
          </>
        )}
      </button>
    </form>
  )
}
