import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Sparkles, Loader2, ExternalLink, BookOpen, Check, Target } from 'lucide-react'

/* ─── Types ─── */

type Tier = 'foundation' | 'core' | 'advanced' | 'specialization'

interface CourseEntry {
  id: string
  labels: string[]
  courseTitle: string
  courseUrl: string
  courseReason: string
  tier: Tier
  term?: string
}

interface SummaryState {
  goal: string
  mode: string
  program?: { title: string; faculty: string }
  courses: CourseEntry[]
}

const TERM_ORDER = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B']
const TIER_ORDER: Tier[] = ['foundation', 'core', 'advanced', 'specialization']
const TIER_LABELS: Record<Tier, string> = {
  foundation: 'Foundation',
  core: 'Core',
  advanced: 'Advanced',
  specialization: 'Specialization',
}
const TIER_DOT: Record<Tier, string> = {
  foundation: 'bg-stone-400',
  core: 'bg-sky-500',
  advanced: 'bg-violet-500',
  specialization: 'bg-pink-500',
}

const REQUIRED_RE = /^required\s*(course)?$/i

/* ─── Helpers ─── */

function groupByTerm(courses: CourseEntry[]): [string, CourseEntry[]][] {
  const map: Record<string, CourseEntry[]> = {}
  for (const c of courses) {
    const t = c.term || '—'
    if (!map[t]) map[t] = []
    map[t].push(c)
  }
  return TERM_ORDER.filter((t) => map[t]).map((t) => [t, map[t]])
}

function groupByTier(courses: CourseEntry[]): [Tier, CourseEntry[]][] {
  const map: Record<string, CourseEntry[]> = {}
  for (const c of courses) {
    if (!map[c.tier]) map[c.tier] = []
    map[c.tier].push(c)
  }
  return TIER_ORDER.filter((t) => map[t]).map((t) => [t, map[t]])
}

/* ─── Course Row ─── */

function CourseRow({ course, isAcademic }: { course: CourseEntry; isAcademic: boolean }) {
  const isRequired = REQUIRED_RE.test(course.courseReason.trim())
  const reason = isRequired ? '' : course.courseReason

  return (
    <div className="py-2 print:py-1.5 print:break-inside-avoid">
      <div className="flex items-baseline gap-2 min-w-0">
        {!isAcademic && (
          <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${TIER_DOT[course.tier]} mt-[5px] self-start print:mt-1`} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <a
              href={course.courseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] font-semibold text-stone-900 no-underline hover:text-blue-900 transition-colors duration-100 print:text-stone-900"
            >
              {course.courseTitle}
              <ExternalLink size={10} className="inline ml-1 -mt-0.5 text-stone-300 print:hidden" />
            </a>
            {isRequired && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-px rounded print:bg-white print:border-emerald-300">
                Req
              </span>
            )}
            {course.labels.length > 0 && (
              <span className="text-[11px] text-stone-400 print:text-stone-500">
                {course.labels.join(' · ')}
              </span>
            )}
          </div>
          {reason && (
            <p className="text-[12px] leading-snug text-stone-400 mt-0.5 print:text-stone-500">
              {reason}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Group Section ─── */

function GroupSection({ label, count, courses, isAcademic }: { label: string; count: number; courses: CourseEntry[]; isAcademic: boolean }) {
  return (
    <section className="print:break-inside-avoid">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-sm font-bold text-stone-700 m-0 uppercase tracking-wide">{label}</h2>
        <span className="text-[11px] text-stone-400">{count}</span>
      </div>
      <div className="divide-y divide-stone-100 print:divide-stone-200">
        {courses.map((c) => (
          <CourseRow key={c.id} course={c} isAcademic={isAcademic} />
        ))}
      </div>
    </section>
  )
}

/* ─── Narrative Block ─── */

function NarrativeSummary({ text, printVisible }: { text: string; printVisible: boolean }) {
  return (
    <div className={`border-l-2 border-blue-300 pl-4 py-1 print:border-stone-400 ${printVisible ? '' : 'print:hidden'}`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Sparkles size={12} className="text-blue-500 print:hidden" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400">AI Summary</span>
      </div>
      <p className="text-[13px] leading-relaxed text-stone-600 whitespace-pre-line m-0 print:text-stone-700">
        {text}
      </p>
    </div>
  )
}

/* ─── Summary Page ─── */

export default function Summary() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as SummaryState | null

  const [narrative, setNarrative] = useState<string | null>(null)
  const [narrativeLoading, setNarrativeLoading] = useState(false)
  const [includeNarrative, setIncludeNarrative] = useState(true)
  const narrativeRef = useRef<AbortController | null>(null)

  if (!state || !state.courses.length) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-stone-50 p-6">
        <BookOpen size={40} className="text-stone-300" />
        <p className="text-stone-500 text-center">No roadmap data available. Go back and generate a graph first.</p>
        <button onClick={() => navigate('/')} className="text-sm font-medium text-blue-900 hover:underline cursor-pointer">
          Go to onboarding
        </button>
      </div>
    )
  }

  const { goal, mode, program, courses } = state
  const isAcademic = mode === 'academics'
  const groups = isAcademic ? groupByTerm(courses) : groupByTier(courses)

  function handleGenerateNarrative() {
    narrativeRef.current?.abort()
    const controller = new AbortController()
    narrativeRef.current = controller
    setNarrativeLoading(true)

    fetch('/api/summary/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, mode, program, nodes: courses }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
    })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { throw new Error(d.error || `Server error (${r.status})`) })
        return r.json()
      })
      .then((data) => {
        setNarrative(data.summary ?? 'No summary returned.')
        setNarrativeLoading(false)
      })
      .catch((e) => {
        if (e.name === 'AbortError') return
        setNarrativeLoading(false)
        toast.error(e.name === 'TimeoutError' ? 'Summary timed out — try again' : `Failed to generate summary: ${e.message}`)
      })
  }

  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="min-h-dvh bg-white">
      {/* Toolbar */}
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-stone-200 print:hidden">
        <div className="max-w-2xl mx-auto px-5 py-2.5 flex items-center justify-between gap-3">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 hover:text-stone-900 cursor-pointer transition-colors duration-150"
          >
            <ArrowLeft size={15} />
            Back
          </button>

          <div className="flex items-center gap-2">
            {!narrative && !narrativeLoading && (
              <button
                onClick={handleGenerateNarrative}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-lg bg-blue-50 text-blue-900 hover:bg-blue-100 cursor-pointer transition-colors duration-150"
              >
                <Sparkles size={13} />
                AI Summary
              </button>
            )}
            {narrativeLoading && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-stone-400">
                <Loader2 size={13} className="animate-spin" />
                Generating…
              </div>
            )}
            {narrative && (
              <button
                onClick={() => setIncludeNarrative((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-lg cursor-pointer transition-colors duration-150 ${
                  includeNarrative
                    ? 'bg-blue-50 text-blue-900 hover:bg-blue-100'
                    : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                }`}
              >
                <span className={`flex items-center justify-center w-3.5 h-3.5 rounded border transition-colors duration-150 ${
                  includeNarrative ? 'bg-blue-900 border-blue-900' : 'border-stone-300 bg-white'
                }`}>
                  {includeNarrative && <Check size={10} className="text-white" strokeWidth={3} />}
                </span>
                Include AI Summary
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-lg bg-stone-900 text-white hover:bg-stone-800 cursor-pointer transition-colors duration-150"
            >
              <Download size={13} />
              PDF
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-5 py-6 print:py-2 print:px-4 print:max-w-none">
        {/* Header */}
        <header className="mb-5 print:mb-4">
          {isAcademic && program && (
            <div className="mb-2">
              <h1 className="text-xl font-bold text-stone-900 m-0 leading-tight">{program.title}</h1>
              <p className="text-xs text-stone-400 mt-0.5">{program.faculty}</p>
            </div>
          )}
          {!isAcademic && (
            <h1 className="text-xl font-bold text-stone-900 m-0 mb-2 leading-tight">Learning Roadmap</h1>
          )}

          {goal && (
            <div className="flex items-start gap-2.5 rounded-lg bg-stone-50 border border-stone-200 px-3.5 py-2.5 print:bg-white print:border-stone-300">
              <Target size={15} className="shrink-0 text-stone-400 mt-0.5" />
              <p className="text-sm text-stone-600 m-0 leading-snug">{goal}</p>
            </div>
          )}

          <div className="flex items-center justify-between mt-3">
            <div className="h-px flex-1 bg-stone-200" />
            <span className="text-[11px] text-stone-400 px-3">{courses.length} courses &middot; {dateStr}</span>
            <div className="h-px flex-1 bg-stone-200" />
          </div>
        </header>

        {/* Course groups */}
        <div className="space-y-5 print:space-y-3">
          {groups.map(([key, items]) => (
            <GroupSection
              key={key}
              label={isAcademic ? `Term ${key}` : TIER_LABELS[key as Tier]}
              count={items.length}
              courses={items}
              isAcademic={isAcademic}
            />
          ))}
        </div>

        {/* AI Narrative — below course list */}
        {narrative && (
          <div className="mt-6 print:mt-4">
            <NarrativeSummary text={narrative} printVisible={includeNarrative} />
          </div>
        )}

        {/* Footer */}
        <footer className="mt-8 pt-4 border-t border-stone-100 text-center print:mt-4 print:pt-2">
          <p className="text-[11px] text-stone-400 m-0">
            Parcours &middot; {dateStr}
          </p>
        </footer>
      </div>
    </div>
  )
}
