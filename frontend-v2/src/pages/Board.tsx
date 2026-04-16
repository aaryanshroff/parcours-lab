import { useState, useMemo, useCallback, useEffect } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  ExternalLink,
  X,
  ChevronDown,
  ChevronRight,
  ThumbsUp,
  Star,
  StickyNote,
  GripVertical,
  Check,
  Users,
} from 'lucide-react'

/* ─── Types ─── */

interface CourseRating {
  liked: number | null
  easy: number | null
  useful: number | null
  filled_count: number | null
}

interface BoardNodeData {
  labels: string[]
  escoSkills: string[]
  courseTitle: string
  courseUrl: string
  courseReason: string
  courseUnits: number
  courseRating?: CourseRating | null
  tier: string
  term?: string
  required?: boolean
  [key: string]: unknown
}

interface FlatCourse {
  id: string
  labels: string[]
  escoSkills: string[]
  courseTitle: string
  courseUrl: string
  courseReason: string
  courseUnits: number
  courseRating?: CourseRating | null
  tier: string
  term: string
  required: boolean
}

const TERM_ORDER = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B']

const NOTES_KEY = 'parcours-board-notes'

interface ClubRecommendation {
  name: string
  category: string
  description: string
  url: string
  match_tier: string
  match_reason: string
}

const MATCH_TIER_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  strong: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Strong match' },
  explore: { bg: 'bg-sky-50', text: 'text-sky-600', label: 'Explore' },
}

/* ─── Board View (embedded in Graph page) ─── */

export default function BoardView({ nodes, edges, title, subtitle, onMoveCourse, completedTerms, onCompleteTerm, onUncompleteTerm, clubs, onViewSummary }: {
  nodes: Node<BoardNodeData>[]
  edges: Edge[]
  title: string
  subtitle?: string
  onMoveCourse: (courseId: string, fromTerm: string, toTerm: string) => void
  completedTerms: Set<string>
  onCompleteTerm: (term: string, nodeIds: string[]) => void
  onUncompleteTerm: (term: string, nodeIds: string[]) => void
  clubs?: ClubRecommendation[]
  onViewSummary?: () => void
}) {
  // Flatten nodes to simple course objects
  const courses: FlatCourse[] = useMemo(() =>
    nodes
      .filter((n) => n.type === 'skill')
      .map((n) => ({
        id: n.id,
        labels: n.data.labels,
        escoSkills: n.data.escoSkills,
        courseTitle: n.data.courseTitle,
        courseUrl: n.data.courseUrl,
        courseReason: n.data.courseReason,
        courseUnits: n.data.courseUnits,
        courseRating: n.data.courseRating,
        tier: n.data.tier,
        term: (n.data.term as string) ?? '',
        required: n.data.required ?? false,
      })),
    [nodes],
  )

  // Prereq maps from edges
  const prereqMap = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const e of edges) {
      if (!map[e.target]) map[e.target] = []
      map[e.target].push(e.source)
    }
    return map
  }, [edges])

  const dependentMap = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const e of edges) {
      if (!map[e.source]) map[e.source] = []
      map[e.source].push(e.target)
    }
    return map
  }, [edges])

  // Group by term
  const coursesByTerm = useMemo(() => {
    const map: Record<string, FlatCourse[]> = {}
    for (const t of TERM_ORDER) map[t] = []
    for (const c of courses) {
      if (c.term && map[c.term]) map[c.term].push(c)
    }
    return map
  }, [courses])

  const termsWithCourses = useMemo(() => [...TERM_ORDER], [])

  // Sidebar state
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null
  const [selectedClubName, setSelectedClubName] = useState<string | null>(null)
  const selectedClub = (clubs ?? []).find((c) => c.name === selectedClubName) ?? null

  // Notes & statuses persisted to localStorage
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}') } catch { return {} }
  })
  useEffect(() => { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)) }, [notes])

  // Drag state
  const [dragCourseId, setDragCourseId] = useState<string | null>(null)
  const [dragOverTerm, setDragOverTerm] = useState<string | null>(null)

  function getPrereqs(courseId: string): FlatCourse[] {
    return (prereqMap[courseId] ?? []).map((id) => courses.find((c) => c.id === id)).filter((c): c is FlatCourse => !!c)
  }

  function getDependents(courseId: string): FlatCourse[] {
    return (dependentMap[courseId] ?? []).map((id) => courses.find((c) => c.id === id)).filter((c): c is FlatCourse => !!c)
  }

  const handleDragStart = useCallback((e: React.DragEvent, courseId: string) => {
    setDragCourseId(courseId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', courseId)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, term: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTerm(term)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverTerm(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetTerm: string) => {
    e.preventDefault()
    setDragOverTerm(null)
    const courseId = e.dataTransfer.getData('text/plain')
    if (!courseId) return
    const course = courses.find((c) => c.id === courseId)
    if (!course || course.term === targetTerm) { setDragCourseId(null); return }
    onMoveCourse(courseId, course.term, targetTerm)
    setDragCourseId(null)
  }, [courses, onMoveCourse])

  const handleDragEnd = useCallback(() => {
    setDragCourseId(null)
    setDragOverTerm(null)
  }, [])

  return (
    <div className="flex h-full w-full bg-stone-50 overflow-hidden">
      {/* Main column: Header + Tracks */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Relative Header */}
        <div className="px-10 pt-8 pb-3 shrink-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-stone-900 mb-0.5">{title}</h1>
              {subtitle && (
                <p className="text-xs text-stone-400">{subtitle}</p>
              )}
            </div>
            {onViewSummary && (
              <button
                onClick={onViewSummary}
                disabled={courses.length === 0}
                className="inline-flex items-center gap-1.5 self-start rounded-xl border border-stone-200 bg-white px-3 py-2.5 shadow-lg transition-shadow duration-200 hover:shadow-xl cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                aria-label="View Summary"
              >
                <ExternalLink size={14} className="text-stone-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Download Summary</span>
              </button>
            )}
          </div>
        </div>

        {/* Board columns */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden overscroll-x-none">
          <div className="flex gap-0 h-full pl-10 pr-0 py-3">
          {termsWithCourses.map((term) => {
            const credits = (coursesByTerm[term] ?? []).reduce((s, c) => s + c.courseUnits, 0)
            const over = credits > 2.5
            const isDragOver = dragOverTerm === term
            const isCompleted = completedTerms.has(term)
            const termIdx = TERM_ORDER.indexOf(term)
            const prevTerm = termIdx > 0 ? TERM_ORDER[termIdx - 1] : null
            const prevTermComplete = !prevTerm || completedTerms.has(prevTerm)
            const canComplete = prevTermComplete && !isCompleted && coursesByTerm[term].length > 0
            const termNodeIds = coursesByTerm[term].map((c) => c.id)
            return (
              <div
                key={term}
                className={`shrink-0 w-72 flex flex-col h-full first:rounded-l-xl last:rounded-r-xl transition-colors duration-150 ${
                  isCompleted ? 'bg-emerald-50/50' : isDragOver ? 'bg-blue-50/50' : 'bg-stone-50/50'
                }`}
                onDragOver={(e) => handleDragOver(e, term)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, term)}
              >
                {/* Column header */}
                <div className="shrink-0 px-3 pt-6 pb-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${isCompleted ? 'text-emerald-600' : 'text-stone-700'}`}>Term {term}</span>
                      <span className={`inline-flex items-center justify-center w-5 h-5 text-[10px] font-medium rounded-full ${isCompleted ? 'bg-emerald-100 text-emerald-600' : 'bg-stone-100 text-stone-500'}`}>
                        {coursesByTerm[term].length}
                      </span>
                      {isCompleted && (
                        <span className="text-[10px] font-medium text-emerald-500">completed</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-medium ${over ? 'text-red-500' : 'text-stone-400'}`}>
                        {credits.toFixed(2)} cr{over ? ' ⚠' : ''}
                      </span>
                      <div className="relative group">
                        <button
                          className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-full border transition-colors duration-150 ${
                            isCompleted
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-600 hover:bg-white cursor-pointer'
                              : canComplete
                                ? 'border-stone-200 bg-white text-stone-400 hover:border-emerald-300 hover:text-emerald-600 cursor-pointer'
                                : 'border-stone-100 bg-stone-50 text-stone-300 cursor-not-allowed'
                          }`}
                          onClick={() => {
                            if (isCompleted) {
                              onUncompleteTerm(term, termNodeIds)
                            } else if (canComplete) {
                              onCompleteTerm(term, termNodeIds)
                            }
                          }}
                          disabled={!isCompleted && !canComplete}
                        >
                          <Check size={9} />
                          {isCompleted ? 'Undo' : 'Complete'}
                        </button>
                        {!isCompleted && !canComplete && prevTerm && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-36 px-2 py-1 text-[10px] leading-snug text-stone-500 bg-white border border-stone-200 rounded-lg shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 z-10 text-center">
                            Complete Term {prevTerm} first
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {coursesByTerm[term].map((course) => {
                    const hasNote = !!notes[course.id]?.trim()
                    const isDragging = dragCourseId === course.id

                    return (
                      <div
                        key={course.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, course.id)}
                        onDragEnd={handleDragEnd}
                        onClick={() => { setSelectedCourseId(course.id); setSelectedClubName(null) }}
                        className={`w-full text-left p-3 rounded-lg border bg-white shadow-sm hover:shadow-md hover:-translate-y-px transition-all duration-150 cursor-pointer ${
                          selectedCourseId === course.id ? 'border-blue-400 ring-2 ring-blue-100' : 'border-stone-200'
                        } ${isDragging ? 'opacity-40' : ''}`}
                      >
                        {/* Drag handle + tags row */}
                        <div className="flex items-center gap-1 mb-1.5">
                          <GripVertical size={12} className="text-stone-300 shrink-0 cursor-grab active:cursor-grabbing" />
                          <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded ${
                            course.required ? 'bg-amber-100 text-amber-700' : 'bg-sky-50 text-sky-500'
                          }`}>
                            {course.required ? 'Required' : 'Elective'}
                          </span>
                        </div>

                        <p className="text-sm font-medium text-stone-900 leading-snug mb-1">{course.courseTitle}</p>
                        <p className="text-xs text-stone-400 mb-1.5">{course.labels.join(', ')}</p>

                        {hasNote && (
                          <div className="flex items-center gap-2 text-[10px] text-stone-400">
                            <StickyNote size={10} className="text-amber-400" />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {/* Clubs column */}
          {clubs && clubs.length > 0 && (
            <div className="shrink-0 w-72 flex flex-col h-full bg-violet-50/30">
              <div className="shrink-0 px-3 pt-6 pb-2.5">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-violet-400" />
                  <span className="text-sm font-semibold text-stone-700">Clubs & Activities</span>
                  <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-medium rounded-full bg-violet-100 text-violet-600">
                    {clubs.length}
                  </span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {clubs.map((club) => {
                  const tierCfg = MATCH_TIER_STYLE[club.match_tier] ?? MATCH_TIER_STYLE.explore
                  return (
                    <div
                      key={club.name}
                      onClick={() => { setSelectedClubName(club.name); setSelectedCourseId(null) }}
                      className={`w-full text-left p-3 rounded-lg border bg-white shadow-sm hover:shadow-md hover:-translate-y-px transition-all duration-150 cursor-pointer ${
                        selectedClubName === club.name ? 'border-violet-400 ring-2 ring-violet-100' : 'border-stone-200'
                      }`}
                    >
                      <div className="flex items-center gap-1 mb-1.5">
                        <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded ${tierCfg.bg} ${tierCfg.text}`}>
                          {tierCfg.label}
                        </span>
                        <span className="text-[9px] font-medium text-stone-400 truncate">{club.category}</span>
                      </div>
                      <p className="text-sm font-medium text-stone-900 leading-snug mb-1">{club.name}</p>
                      {club.description && (
                        <p className="text-xs text-stone-400 line-clamp-2">{club.description}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Explicit right edge spacer element against scroll clipping */}
          <div className="w-10 shrink-0" />
        </div>
      </div>
      </div>

      {/* Sidebar detail panel */}
      {selectedCourse && !selectedClub && (
        <CourseSidebar
          course={selectedCourse}
          prereqs={getPrereqs(selectedCourse.id)}
          dependents={getDependents(selectedCourse.id)}
          note={notes[selectedCourse.id] ?? ''}
          onNoteChange={(val) => setNotes((prev) => ({ ...prev, [selectedCourse.id]: val }))}
          onClose={() => setSelectedCourseId(null)}
          onNavigate={(id) => setSelectedCourseId(id)}
        />
      )}

      {/* Club sidebar */}
      {selectedClub && (
        <ClubSidebar
          club={selectedClub}
          onClose={() => setSelectedClubName(null)}
        />
      )}
    </div>
  )
}

/* ─── Sidebar Component ─── */

function CourseSidebar({
  course, prereqs, dependents, note,
  onNoteChange, onClose, onNavigate,
}: {
  course: FlatCourse
  prereqs: FlatCourse[]
  dependents: FlatCourse[]
  note: string
  onNoteChange: (val: string) => void
  onClose: () => void
  onNavigate: (id: string) => void
}) {
  const [prereqsExpanded, setPrereqsExpanded] = useState(true)
  const [dependentsExpanded, setDependentsExpanded] = useState(false)

  return (
    <div className="w-96 shrink-0 bg-white border-l border-stone-200 flex flex-col h-full shadow-lg animate-slide-in relative z-[60] pt-4">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-stone-100">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded ${
                course.required ? 'bg-amber-100 text-amber-700' : 'bg-sky-50 text-sky-500'
              }`}>
                {course.required ? 'Required' : 'Elective'}
              </span>
              <span className="text-[10px] text-stone-400 font-medium">Term {course.term}</span>
            </div>
            <a
              href={course.courseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-semibold text-stone-900 leading-snug no-underline hover:text-blue-900 transition-colors"
            >
              <ExternalLink size={12} className="inline mr-1 -mt-0.5" />
              {course.courseTitle}
            </a>
            <p className="text-xs text-stone-400 mt-0.5">{course.labels.join(', ')} · {course.courseUnits} credits</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-stone-400 hover:text-stone-600 hover:bg-stone-100 cursor-pointer transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Properties */}
        <div className="px-5 py-4 space-y-3 border-b border-stone-100">
          <div className="flex items-center gap-3">
            <span className="text-xs text-stone-400 w-20 shrink-0">Term</span>
            <span className="text-xs font-medium text-stone-700 px-2 py-0.5 rounded bg-stone-100">{course.term}</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-stone-400 w-20 shrink-0">Credits</span>
            <span className="text-xs text-stone-700">{course.courseUnits}</span>
          </div>

          {course.courseRating?.liked != null && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-stone-400 w-20 shrink-0">Rating</span>
              <div className="flex items-center gap-3 text-xs text-stone-600">
                <span className="inline-flex items-center gap-1">
                  <ThumbsUp size={11} />
                  {Math.round(course.courseRating.liked * 100)}% liked
                </span>
                {course.courseRating.useful != null && (
                  <span className="inline-flex items-center gap-1">
                    <Star size={11} />
                    {Math.round(course.courseRating.useful * 100)}% useful
                  </span>
                )}
                {course.courseRating.easy != null && (
                  <span className="text-stone-400">
                    {Math.round(course.courseRating.easy * 100)}% easy
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Reason */}
        {course.courseReason && (
          <div className="px-5 py-4 border-b border-stone-100">
            <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Why this course?</h3>
            <p className="text-sm text-stone-600 leading-relaxed">{course.courseReason}</p>
          </div>
        )}

        {/* Skills */}
        {course.escoSkills.length > 0 && (
          <div className="px-5 py-4 border-b border-stone-100">
            <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Skills</h3>
            <div className="flex flex-wrap gap-1.5">
              {course.escoSkills.map((skill) => (
                <span key={skill} className="inline-block px-2 py-0.5 text-[11px] font-medium rounded-full bg-violet-50 text-violet-600 border border-violet-200">
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Prerequisites */}
        <div className="px-5 py-4 border-b border-stone-100">
          <button
            onClick={() => setPrereqsExpanded((v) => !v)}
            className="flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer w-full"
          >
            {prereqsExpanded ? <ChevronDown size={13} className="text-stone-400" /> : <ChevronRight size={13} className="text-stone-400" />}
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Prerequisites</span>
            <span className="text-[10px] text-stone-400 ml-1">{prereqs.length}</span>
          </button>
          {prereqsExpanded && (
            <div className="mt-2 space-y-1.5">
              {prereqs.length === 0 ? (
                <p className="text-xs text-stone-400 italic">No prerequisites</p>
              ) : prereqs.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onNavigate(p.id)}
                  className="w-full text-left flex items-center gap-2 p-2 rounded-md hover:bg-stone-50 cursor-pointer transition-colors border border-transparent hover:border-stone-200"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-stone-300 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-stone-700 truncate">{p.courseTitle}</p>
                    <p className="text-[10px] text-stone-400">{p.labels.join(', ')} · Term {p.term}</p>
                  </div>
                  <ChevronRight size={12} className="text-stone-300 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Unlocks */}
        <div className="px-5 py-4 border-b border-stone-100">
          <button
            onClick={() => setDependentsExpanded((v) => !v)}
            className="flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer w-full"
          >
            {dependentsExpanded ? <ChevronDown size={13} className="text-stone-400" /> : <ChevronRight size={13} className="text-stone-400" />}
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Unlocks</span>
            <span className="text-[10px] text-stone-400 ml-1">{dependents.length}</span>
          </button>
          {dependentsExpanded && (
            <div className="mt-2 space-y-1.5">
              {dependents.length === 0 ? (
                <p className="text-xs text-stone-400 italic">No dependent courses</p>
              ) : dependents.map((d) => (
                <button
                  key={d.id}
                  onClick={() => onNavigate(d.id)}
                  className="w-full text-left flex items-center gap-2 p-2 rounded-md hover:bg-stone-50 cursor-pointer transition-colors border border-transparent hover:border-stone-200"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-300 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-stone-700 truncate">{d.courseTitle}</p>
                    <p className="text-[10px] text-stone-400">{d.labels.join(', ')} · Term {d.term}</p>
                  </div>
                  <ChevronRight size={12} className="text-stone-300 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="px-5 py-4">
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <StickyNote size={11} />
            Notes
          </h3>
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="Add your notes about this course…"
            className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none transition-all min-h-[100px]"
          />
        </div>
      </div>
    </div>
  )
}

/* ─── Club Sidebar ─── */

function ClubSidebar({ club, onClose }: {
  club: ClubRecommendation
  onClose: () => void
}) {
  const tierCfg = MATCH_TIER_STYLE[club.match_tier] ?? MATCH_TIER_STYLE.explore

  return (
    <div className="w-96 shrink-0 bg-white border-l border-stone-200 flex flex-col h-full shadow-lg animate-slide-in relative z-[60] pt-4">
      {/* Header */}
      <div className="shrink-0 px-5 py-4 border-b border-stone-100">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded ${tierCfg.bg} ${tierCfg.text}`}>
                {tierCfg.label}
              </span>
              <span className="text-[10px] text-stone-400 font-medium">{club.category}</span>
            </div>
            <a
              href={club.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-base font-semibold text-stone-900 leading-snug no-underline hover:text-violet-800 transition-colors"
            >
              <ExternalLink size={12} className="inline mr-1 -mt-0.5" />
              {club.name}
            </a>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-stone-400 hover:text-stone-600 hover:bg-stone-100 cursor-pointer transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Why this club */}
        {club.match_reason && (
          <div className="px-5 py-4 border-b border-stone-100">
            <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Why this club?</h3>
            <p className="text-sm text-violet-600 leading-relaxed">{club.match_reason}</p>
          </div>
        )}

        {/* Description */}
        {club.description && (
          <div className="px-5 py-4 border-b border-stone-100">
            <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">About</h3>
            <p className="text-sm text-stone-600 leading-relaxed">{club.description}</p>
          </div>
        )}

        {/* Link */}
        <div className="px-5 py-4">
          <a
            href={club.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 no-underline transition-colors"
          >
            <ExternalLink size={14} />
            View on WUSA
          </a>
        </div>
      </div>
    </div>
  )
}
