import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
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

const STATUS_COLORS: Record<string, { dot: string; bg: string; text: string; label: string }> = {
  'not-started': { dot: 'bg-stone-300', bg: 'bg-stone-50', text: 'text-stone-500', label: 'Not Started' },
  'in-progress': { dot: 'bg-blue-400', bg: 'bg-blue-50', text: 'text-blue-600', label: 'In Progress' },
  'completed':   { dot: 'bg-emerald-400', bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Completed' },
}

const NOTES_KEY = 'parcours-board-notes'
const STATUSES_KEY = 'parcours-board-statuses'

/* ─── Board View (embedded in Graph page) ─── */

export default function BoardView({ nodes, edges, title, subtitle, onMoveCourse }: {
  nodes: Node<BoardNodeData>[]
  edges: Edge[]
  title: string
  subtitle?: string
  onMoveCourse: (courseId: string, fromTerm: string, toTerm: string) => void
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

  // Notes & statuses persisted to localStorage
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(NOTES_KEY) ?? '{}') } catch { return {} }
  })
  const [statuses, setStatuses] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(STATUSES_KEY) ?? '{}') } catch { return {} }
  })

  useEffect(() => { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)) }, [notes])
  useEffect(() => { localStorage.setItem(STATUSES_KEY, JSON.stringify(statuses)) }, [statuses])

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
          <h1 className="text-xl font-bold text-stone-900 mb-0.5">{title}</h1>
          {subtitle && (
            <p className="text-xs text-stone-400">{subtitle}</p>
          )}
        </div>

        {/* Board columns */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden overscroll-x-none">
          <div className="flex gap-0 h-full pl-10 pr-0 py-3">
          {termsWithCourses.map((term) => {
            const credits = (coursesByTerm[term] ?? []).reduce((s, c) => s + c.courseUnits, 0)
            const over = credits > 2.5
            const isDragOver = dragOverTerm === term
            return (
              <div
                key={term}
                className={`shrink-0 w-72 flex flex-col h-full first:rounded-l-xl last:rounded-r-xl transition-colors duration-150 ${
                  isDragOver ? 'bg-blue-50/50' : 'bg-stone-50/50'
                }`}
                onDragOver={(e) => handleDragOver(e, term)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, term)}
              >
                {/* Column header */}
                <div className="shrink-0 px-3 pt-6 pb-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-stone-700">Term {term}</span>
                      <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-medium rounded-full bg-stone-100 text-stone-500">
                        {coursesByTerm[term].length}
                      </span>
                    </div>
                    <span className={`text-[10px] font-medium ${over ? 'text-red-500' : 'text-stone-400'}`}>
                      {credits.toFixed(2)} cr{over ? ' ⚠' : ''}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {coursesByTerm[term].map((course) => {
                    const status = statuses[course.id] ?? 'not-started'
                    const statusConfig = STATUS_COLORS[status]
                    const prereqs = getPrereqs(course.id)
                    const hasNote = !!notes[course.id]?.trim()
                    const isDragging = dragCourseId === course.id

                    return (
                      <div
                        key={course.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, course.id)}
                        onDragEnd={handleDragEnd}
                        onClick={() => setSelectedCourseId(course.id)}
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
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-medium rounded ${statusConfig.bg} ${statusConfig.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
                            {statusConfig.label}
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
          {/* Explicit right edge spacer element against scroll clipping */}
          <div className="w-10 shrink-0" />
        </div>
      </div>
      </div>

      {/* Sidebar detail panel */}
      {selectedCourse && (
        <CourseSidebar
          course={selectedCourse}
          prereqs={getPrereqs(selectedCourse.id)}
          dependents={getDependents(selectedCourse.id)}
          note={notes[selectedCourse.id] ?? ''}
          status={statuses[selectedCourse.id] ?? 'not-started'}
          onNoteChange={(val) => setNotes((prev) => ({ ...prev, [selectedCourse.id]: val }))}
          onStatusChange={(val) => setStatuses((prev) => ({ ...prev, [selectedCourse.id]: val }))}
          onClose={() => setSelectedCourseId(null)}
          onNavigate={(id) => setSelectedCourseId(id)}
        />
      )}
    </div>
  )
}

/* ─── Sidebar Component ─── */

function CourseSidebar({
  course, prereqs, dependents, note, status,
  onNoteChange, onStatusChange, onClose, onNavigate,
}: {
  course: FlatCourse
  prereqs: FlatCourse[]
  dependents: FlatCourse[]
  note: string
  status: string
  onNoteChange: (val: string) => void
  onStatusChange: (val: string) => void
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
            <span className="text-xs text-stone-400 w-20 shrink-0">Status</span>
            <select
              value={status}
              onChange={(e) => onStatusChange(e.target.value)}
              className="text-xs font-medium rounded-md border border-stone-200 px-2 py-1 bg-white text-stone-700 cursor-pointer"
            >
              {Object.entries(STATUS_COLORS).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
          </div>

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
