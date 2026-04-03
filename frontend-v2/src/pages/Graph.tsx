import { useState, useRef, useEffect, useCallback, useMemo, createContext, useContext } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type OnNodesChange,
  Handle,
  Position,
  BaseEdge,
  Background,
  BackgroundVariant,
  MarkerType,
  applyNodeChanges,
} from '@xyflow/react'
import { ExternalLink, Check, X, RefreshCw, ChevronDown, Loader2, Undo2, HelpCircle, FileText } from 'lucide-react'
import Dagre from '@dagrejs/dagre'
import GoatChat from '../components/GoatChat'

/* ─── Layout helpers ─── */

const NODE_W = 260
const NODE_H = 160

function layoutGraph(nodes: Node<SkillNodeData>[], edges: Edge[]): Node<SkillNodeData>[] {
  const g = new Dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 100 })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_W, height: NODE_H })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  Dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    return {
      ...node,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
    }
  })
}

/* ─── Types ─── */

type Tier = 'foundation' | 'core' | 'advanced' | 'specialization'
type CourseStatus = 'pending' | 'accepted' | 'replacing' | 'loading' | 'replaced'

interface SkillNodeData {
  labels: string[]
  courseTitle: string
  courseUrl: string
  courseReason: string
  courseUnits: number
  tier: Tier
  term?: string
  termCredits?: number
  [key: string]: unknown
}

const tierConfig: Record<Tier, { border: string; borderAccepted: string; text: string; label: string }> = {
  foundation:     { border: 'border-stone-300',  borderAccepted: 'border-emerald-400', text: 'text-stone-400',  label: 'Foundation' },
  core:           { border: 'border-sky-300',    borderAccepted: 'border-emerald-400', text: 'text-sky-400',    label: 'Core' },
  advanced:       { border: 'border-violet-300', borderAccepted: 'border-emerald-400', text: 'text-violet-500', label: 'Advanced' },
  specialization: { border: 'border-pink-300',   borderAccepted: 'border-emerald-400', text: 'text-pink-400',   label: 'Specialization' },
}

/* ─── Course status context ─── */

type CourseState = {
  status: CourseStatus
  reason?: string
}

interface CourseContextValue {
  store: Record<string, CourseState>
  prerequisites: Record<string, string[]>
  accept: (nodeId: string) => void
  startReplace: (nodeId: string) => void
  submitReplace: (nodeId: string, reason: string, skill: string, currentCourse: string) => void
  cancelReplace: (nodeId: string) => void
}

const CourseContext = createContext<CourseContextValue>(null!)

function CourseProvider({ children, edges, setNodes, onCourseReplaced }: { children: React.ReactNode; edges: Edge[]; setNodes: React.Dispatch<React.SetStateAction<Node<SkillNodeData>[]>>; onCourseReplaced?: (entry: HistoryEntry) => void }) {
  const [store, setStore] = useState<Record<string, CourseState>>({})

  const prerequisites = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const e of edges) {
      if (!map[e.target]) map[e.target] = []
      map[e.target].push(e.source)
    }
    return map
  }, [edges])

  const accept = useCallback((nodeId: string) => {
    setStore((s) => ({ ...s, [nodeId]: { status: 'accepted' } }))
  }, [])

  const startReplace = useCallback((nodeId: string) => {
    setStore((s) => ({ ...s, [nodeId]: { status: 'replacing' } }))
  }, [])

  const submitReplace = useCallback(async (nodeId: string, reason: string, skill: string, currentCourse: string) => {
    setStore((s) => ({ ...s, [nodeId]: { status: 'loading' } }))
    try {
      const res = await fetch('/api/course/replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill, current_course: currentCourse, reason }),
      })
      const data = await res.json()
      onCourseReplaced?.({ skill, oldCourse: currentCourse, newCourse: data.course.title })
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, courseTitle: data.course.title, courseUrl: data.course.url, courseReason: data.course.reason ?? '' } }
            : n,
        ),
      )
      setStore((s) => ({ ...s, [nodeId]: { status: 'pending' } }))
    } catch {
      setStore((s) => ({ ...s, [nodeId]: { status: 'replacing' } }))
    }
  }, [setNodes])

  const cancelReplace = useCallback((nodeId: string) => {
    setStore((s) => {
      const copy = { ...s }
      delete copy[nodeId]
      return copy
    })
  }, [])

  return (
    <CourseContext.Provider value={{ store, prerequisites, accept, startReplace, submitReplace, cancelReplace }}>
      {children}
    </CourseContext.Provider>
  )
}

function useCourse(nodeId: string) {
  const ctx = useContext(CourseContext)
  const state: CourseState = ctx.store[nodeId] ?? { status: 'pending' }
  const prereqs = ctx.prerequisites[nodeId] ?? []
  const locked = prereqs.length > 0 && !prereqs.every((pid) => ctx.store[pid]?.status === 'accepted')
  return { state, locked, ...ctx }
}

/* ─── Skill Node ─── */

function SkillNode({ id, data }: NodeProps<Node<SkillNodeData>>) {
  const config = tierConfig[data.tier]
  const { state, locked, accept, startReplace, submitReplace, cancelReplace } = useCourse(id)
  const [reason, setReason] = useState('')

  const isAccepted = state.status === 'accepted'
  const isReplacing = state.status === 'replacing'
  const borderClass = locked ? 'border-stone-200' : isAccepted ? config.borderAccepted : config.border

  return (
    <div
      className={`rounded-xl border-2 ${borderClass} transition-all duration-200 ${locked ? 'bg-stone-100' : 'bg-white hover:-translate-y-0.5'}`}
      style={{ width: NODE_W, padding: '14px 16px' }}
    >
      <Handle type="target" position={data.term ? Position.Left : Position.Top} style={{ opacity: 0 }} />

      <div className={locked ? 'opacity-40' : ''}>
      {!data.term && (
        <span className={`block text-[10px] font-semibold uppercase tracking-wide ${config.text} mb-1`}>
          {config.label}
        </span>
      )}

      {locked ? (
        <span className="block text-[15px] font-semibold text-stone-900 leading-tight mb-2">
          {data.courseTitle}
        </span>
      ) : (
        <a
          className="nodrag nopan block text-[15px] font-semibold text-stone-900 leading-tight mb-2 no-underline hover:text-blue-900 transition-colors duration-150 cursor-pointer"
          href={data.courseUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={12} className="inline shrink-0 mr-1 -mt-0.5" />
          {data.courseTitle}
        </a>
      )}

      <div className="flex items-center gap-1.5">
        <div>
          <span className="block text-[9px] font-medium uppercase tracking-wider text-stone-400 mb-0.5">
            {data.labels.length > 1 ? 'Skills' : 'Skill'}
          </span>
          <div className="flex flex-wrap gap-1">
            {data.labels.map((skill) => (
              <span key={skill} className="text-xs text-stone-400">{skill}</span>
            ))}
          </div>
        </div>
        {data.courseReason && (
          <div className="relative group shrink-0 self-end mb-0.5">
            <HelpCircle size={13} className="text-stone-300 hover:text-stone-500 cursor-help transition-colors duration-150" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 px-2.5 py-1.5 text-[11px] leading-snug text-stone-600 bg-white border border-stone-200 rounded-lg shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-150 z-10">
              {data.courseReason}
            </div>
          </div>
        )}
      </div>

      {!locked && state.status === 'pending' && (
        <div className="flex gap-1.5 mt-3 nodrag">
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => accept(id)}
            className="nopan inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer transition-colors duration-150"
          >
            <Check size={11} />
            Mark as Complete
          </button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => startReplace(id)}
            className="nopan inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg bg-stone-100 text-stone-600 hover:bg-stone-200 cursor-pointer transition-colors duration-150"
          >
            <RefreshCw size={11} />
            Replace
          </button>
        </div>
      )}

      {!locked && isAccepted && (
        <div className="flex items-center gap-1 mt-3 text-[11px] font-medium text-emerald-600">
          <Check size={12} />
          Completed
        </div>
      )}

      {!locked && isReplacing && (
        <div className="flex flex-col gap-1.5 mt-3 nodrag">
          <textarea
            className="nopan w-full border border-stone-300 rounded-lg px-2 py-1.5 text-xs text-stone-900 outline-none focus:border-blue-800 focus:ring-2 focus:ring-blue-900/15 resize-none transition-all duration-150"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
          <div className="flex gap-1.5 justify-end">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { setReason(''); cancelReplace(id) }}
              className="nopan px-2 py-1 text-[11px] font-medium rounded-lg border border-stone-200 bg-white text-stone-500 hover:bg-stone-50 cursor-pointer transition-colors duration-150"
            >
              Cancel
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { submitReplace(id, reason, data.labels.join(', '), data.courseTitle); setReason('') }}
              className="nopan px-2 py-1 text-[11px] font-medium rounded-lg bg-blue-900 text-white hover:bg-blue-950 cursor-pointer transition-colors duration-150"
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {!locked && state.status === 'loading' && (
        <div className="flex items-center gap-1.5 mt-3 text-[11px] font-medium text-stone-400">
          <Loader2 size={12} className="animate-spin" />
          Finding a new course…
        </div>
      )}
      </div>

      <Handle type="source" position={data.term ? Position.Right : Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

function TermGroupNode({ data }: NodeProps<Node<SkillNodeData>>) {
  const credits = data.termCredits ?? 0
  const over = credits > 3.25
  return (
    <div
      className="rounded-2xl border-2 border-dashed border-stone-200 bg-stone-50/30"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <div className="absolute inset-x-0 top-2 flex justify-center">
        <span className={`px-3 py-0.5 rounded-full bg-white border text-[11px] font-bold uppercase tracking-wider shadow-sm flex items-center gap-1.5 ${over ? 'border-red-300 text-red-500' : 'border-stone-200 text-stone-400'}`}>
          Term {data.term}
          <span className={`font-normal normal-case tracking-normal ${over ? 'text-red-400' : 'text-stone-300'}`}>
            {credits.toFixed(2)} cr{over ? ' ⚠ >3.25' : ''}
          </span>
        </span>
      </div>
    </div>
  )
}

const nodeTypes = { skill: SkillNode, termGroup: TermGroupNode }

function AcademicEdge({ sourceX, sourceY, targetX, targetY, markerEnd, style, data }: EdgeProps) {
  const midX = (sourceX + targetX) / 2
  const path = [
    `M ${sourceX} ${sourceY}`,
    `L ${midX} ${sourceY}`,
    `L ${midX} ${targetY}`,
    `L ${targetX} ${targetY}`,
  ].join(' ')
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} />
}

const edgeTypes = { academicEdge: AcademicEdge }

/* ─── Goal Panel ─── */

function GoalPanel({ goal, program }: { goal: string; program?: { title: string; faculty: string } }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="w-full sm:w-80 bg-white rounded-xl shadow-lg border border-stone-200 p-3 sm:p-4 hover:shadow-xl transition-shadow duration-200">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer"
      >
        <ChevronDown size={14} className={`text-stone-400 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          {program ? 'Program' : 'Goal'}
        </span>
      </button>

      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
      >
        <div className="overflow-hidden">
          <div className="pt-2">
            {program ? (
              <>
                <p className="text-sm sm:text-base font-medium text-stone-900 m-0 leading-snug">{program.title}</p>
                <p className="text-xs text-stone-400 mt-0.5">{program.faculty}</p>
              </>
            ) : (
              <p className="text-sm sm:text-base font-medium text-stone-900 m-0 leading-snug">
                {goal || <span className="text-stone-400 font-normal italic">No goal specified</span>}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Desired Skills Panel ─── */

function DesiredSkillsPanel({ skills, onSkillsChange, loading }: { skills: string[]; onSkillsChange: (skills: string[]) => void; loading?: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const [overflowVisible, setOverflowVisible] = useState(true)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setSuggestions([])
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      fetch(`/api/esco/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => {
          const titles: string[] = (data.results ?? [])
            .map((r: { title: string }) => r.title)
            .filter((t: string) => !skills.includes(t))
          setSuggestions(titles)
        })
        .catch((e) => { if (e.name !== 'AbortError') throw e })
        .finally(() => setSearching(false))
    }, 300)

    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [query, skills])

  function addSkill(skill: string) {
    onSkillsChange([...skills, skill])
    setQuery('')
    setSuggestions([])
    setOpen(false)
    inputRef.current?.focus()
  }

  function removeSkill(skill: string) {
    onSkillsChange(skills.filter((s) => s !== skill))
  }

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as HTMLElement) &&
        inputRef.current && !inputRef.current.contains(e.target as HTMLElement)
      ) {
        setOpen(false)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick, true)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick, true)
    }
  }, [open])

  return (
    <div className="w-full sm:w-80 bg-white rounded-xl shadow-lg border border-stone-200 p-3 sm:p-4 hover:shadow-xl transition-shadow duration-200">
      <button
        onClick={() => {
          const willCollapse = !collapsed
          if (willCollapse) setOverflowVisible(false)
          setCollapsed(willCollapse)
        }}
        className="flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer"
      >
        <ChevronDown size={14} className={`text-stone-400 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          Desired Skills
        </span>
      </button>

      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
        onTransitionEnd={(e) => {
          if (e.propertyName === 'grid-template-rows' && !collapsed) {
            setOverflowVisible(true)
          }
        }}
      >
        <div className={overflowVisible ? 'overflow-visible' : 'overflow-hidden'}>
          {loading && skills.length === 0 ? (
            <div className="flex items-center gap-2 py-1 pt-3">
              <Loader2 size={14} className="text-blue-800 animate-spin" />
              <span className="text-sm text-stone-400">Loading…</span>
            </div>
          ) : <div className={`pt-3 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-stone-100 text-stone-700 transition-colors duration-150"
                >
                  {skill}
                  <button
                    onClick={() => removeSkill(skill)}
                    className="p-0.5 -mr-1 rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-300 cursor-pointer transition-all duration-150"
                    aria-label={`Remove ${skill}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>

            <div className="relative">
              <div className="flex items-center border border-stone-300 rounded-lg overflow-hidden focus-within:border-blue-800 focus-within:ring-2 focus-within:ring-blue-900/15 transition-all duration-150">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Add a skill..."
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
                  onFocus={() => setOpen(true)}
                  className="flex-1 px-2.5 py-1.5 text-sm text-stone-900 outline-none bg-transparent"
                />
                <ChevronDown
                  size={14}
                  className="mr-2 text-stone-400 cursor-pointer"
                  onClick={() => { setOpen(!open); inputRef.current?.focus() }}
                />
              </div>

              {open && (searching || suggestions.length > 0 || query.trim().length >= 2) && (
                <div
                  ref={dropdownRef}
                  className="absolute top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg max-h-40 overflow-y-auto z-20"
                >
                  {searching ? (
                    <div className="flex items-center gap-2 px-3 py-2">
                      <Loader2 size={12} className="text-stone-400 animate-spin" />
                      <span className="text-sm text-stone-400">Searching ESCO…</span>
                    </div>
                  ) : <>
                    {query.trim() && !suggestions.includes(query.trim()) && !skills.includes(query.trim()) && (
                      <button
                        key="__custom__"
                        onClick={() => addSkill(query.trim())}
                        className="w-full text-left px-3 py-1.5 text-sm text-stone-900 font-medium hover:bg-stone-50 cursor-pointer transition-colors duration-100"
                      >
                        Add "{query.trim()}"
                      </button>
                    )}
                    {suggestions.map((skill) => (
                      <button
                        key={skill}
                        onClick={() => addSkill(skill)}
                        className="w-full text-left px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 cursor-pointer transition-colors duration-100"
                      >
                        {skill}
                      </button>
                    ))}
                  </>}
                </div>
              )}
            </div>
          </div>}
        </div>
      </div>
    </div>
  )
}

/* ─── My Skills Panel ─── */

function MySkillsPanel({ skills, onSkillsChange, loading }: { skills: string[]; onSkillsChange: (skills: string[]) => void; loading?: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const [overflowVisible, setOverflowVisible] = useState(true)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setSuggestions([])
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      fetch(`/api/esco/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((data) => {
          const titles: string[] = (data.results ?? [])
            .map((r: { title: string }) => r.title)
            .filter((t: string) => !skills.includes(t))
          setSuggestions(titles)
        })
        .catch((e) => { if (e.name !== 'AbortError') throw e })
        .finally(() => setSearching(false))
    }, 300)

    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [query, skills])

  function addSkill(skill: string) {
    onSkillsChange([...skills, skill])
    setQuery('')
    setSuggestions([])
    setOpen(false)
    inputRef.current?.focus()
  }

  function removeSkill(skill: string) {
    onSkillsChange(skills.filter((s) => s !== skill))
  }

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as HTMLElement) &&
        inputRef.current && !inputRef.current.contains(e.target as HTMLElement)
      ) {
        setOpen(false)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick, true)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick, true)
    }
  }, [open])

  return (
    <div className="w-full sm:w-80 bg-white rounded-xl shadow-lg border border-stone-200 p-3 sm:p-4 hover:shadow-xl transition-shadow duration-200">
      <button
        onClick={() => {
          const willCollapse = !collapsed
          if (willCollapse) setOverflowVisible(false)
          setCollapsed(willCollapse)
        }}
        className="flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer"
      >
        <ChevronDown size={14} className={`text-stone-400 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          My Skills
        </span>
      </button>

      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
        onTransitionEnd={(e) => {
          if (e.propertyName === 'grid-template-rows' && !collapsed) {
            setOverflowVisible(true)
          }
        }}
      >
        <div className={overflowVisible ? 'overflow-visible' : 'overflow-hidden'}>
          {loading && skills.length === 0 ? (
            <div className="flex items-center gap-2 py-1 pt-3">
              <Loader2 size={14} className="text-blue-800 animate-spin" />
              <span className="text-sm text-stone-400">Loading…</span>
            </div>
          ) : <div className={`pt-3 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
            {skills.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-900 transition-colors duration-150"
                  >
                    {skill}
                    <button
                      onClick={() => removeSkill(skill)}
                      className="p-0.5 -mr-1 rounded-full text-blue-400 hover:text-blue-900 hover:bg-blue-200 cursor-pointer transition-all duration-150"
                      aria-label={`Remove ${skill}`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-stone-400 mb-3">No existing skills detected.</p>
            )}

            <div className="relative">
              <div className="flex items-center border border-stone-300 rounded-lg overflow-hidden focus-within:border-blue-800 focus-within:ring-2 focus-within:ring-blue-900/15 transition-all duration-150">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Add a skill..."
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
                  onFocus={() => setOpen(true)}
                  className="flex-1 px-2.5 py-1.5 text-sm text-stone-900 outline-none bg-transparent"
                />
                <ChevronDown
                  size={14}
                  className="mr-2 text-stone-400 cursor-pointer"
                  onClick={() => { setOpen(!open); inputRef.current?.focus() }}
                />
              </div>

              {open && (searching || suggestions.length > 0 || query.trim().length >= 2) && (
                <div
                  ref={dropdownRef}
                  className="absolute top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg max-h-40 overflow-y-auto z-20"
                >
                  {searching ? (
                    <div className="flex items-center gap-2 px-3 py-2">
                      <Loader2 size={12} className="text-stone-400 animate-spin" />
                      <span className="text-sm text-stone-400">Searching ESCO…</span>
                    </div>
                  ) : <>
                    {query.trim() && !suggestions.includes(query.trim()) && !skills.includes(query.trim()) && (
                      <button
                        key="__custom__"
                        onClick={() => addSkill(query.trim())}
                        className="w-full text-left px-3 py-1.5 text-sm text-stone-900 font-medium hover:bg-stone-50 cursor-pointer transition-colors duration-100"
                      >
                        Add "{query.trim()}"
                      </button>
                    )}
                    {suggestions.map((skill) => (
                      <button
                        key={skill}
                        onClick={() => addSkill(skill)}
                        className="w-full text-left px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 cursor-pointer transition-colors duration-100"
                      >
                        {skill}
                      </button>
                    ))}
                  </>}
                </div>
              )}
            </div>
          </div>}
        </div>
      </div>
    </div>
  )
}

/* ─── Course History Panel ─── */

interface HistoryEntry {
  skill: string
  oldCourse: string
  newCourse: string
}

function CourseHistoryPanel({ history, onRestore }: { history: HistoryEntry[]; onRestore: (index: number) => void }) {
  const [collapsed, setCollapsed] = useState(history.length === 0)

  useEffect(() => {
    if (history.length > 0) setCollapsed(false)
  }, [history.length])

  return (
    <div className="w-full sm:w-80 bg-white rounded-xl shadow-lg border border-stone-200 p-3 sm:p-4 hover:shadow-xl transition-shadow duration-200 overflow-hidden">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer"
      >
        <ChevronDown size={14} className={`text-stone-400 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          Course History
        </span>
      </button>

      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
      >
        <div className="overflow-hidden">
          <div className="pt-3">
            {history.length === 0 ? (
              <p className="text-sm text-stone-400">No replacements yet.</p>
            ) : (
              <div className="divide-y divide-stone-100">
                {history.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0">
                    <RefreshCw size={14} className="shrink-0 text-stone-300" />
                    <div className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-stone-800 truncate">{entry.skill}</span>
                      <span className="block text-[11px] text-stone-400 truncate">{entry.oldCourse}</span>
                    </div>
                    <button
                      onClick={() => onRestore(i)}
                      className="shrink-0 p-1 rounded-md text-stone-300 hover:text-blue-900 hover:bg-blue-50 cursor-pointer transition-colors duration-150"
                      aria-label={`Restore ${entry.oldCourse}`}
                    >
                      <Undo2 size={14} />
                    </button>
                  </div>
              ))}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── API types ─── */

interface ApiCourse { title: string; url: string; reason: string; units?: number }
interface ApiNode { id: string; labels: string[]; tier: string; course: ApiCourse; position: { x: number; y: number }; term?: string }
interface ApiEdge { id: string; source: string; target: string }
interface ApiGraph { goal: string; skills: string[]; nodes: ApiNode[]; edges: ApiEdge[] }

function toFlowNodes(apiNodes: ApiNode[]): Node<SkillNodeData>[] {
  return apiNodes.map((n) => ({
    id: n.id,
    type: 'skill',
    position: n.position,
    data: {
      labels: n.labels,
      tier: n.tier as Tier,
      term: n.term,
      courseTitle: n.course.title,
      courseUrl: n.course.url,
      courseReason: n.course.reason ?? '',
      courseUnits: n.course.units ?? 0.5,
    },
  }))
}

const TERM_ORDER = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B']

function addTermGroups(courseNodes: Node<SkillNodeData>[]): Node<SkillNodeData>[] {
  // Group courses by term and create dashed vertical swim-lane columns behind them
  const byTerm: Record<string, Node<SkillNodeData>[]> = {}
  for (const n of courseNodes) {
    const t = n.data.term
    if (!t) continue
    if (!byTerm[t]) byTerm[t] = []
    byTerm[t].push(n)
  }

  // Find global Y range so all columns share the same height
  const allYs = courseNodes.map((n) => n.position.y)
  const globalMinY = Math.min(...allYs)
  const globalMaxY = Math.max(...allYs) + NODE_H

  const PAD_X = 20
  const PAD_TOP = 36
  const PAD_BOTTOM = 24
  const groupNodes: Node<SkillNodeData>[] = []

  for (const term of TERM_ORDER) {
    const members = byTerm[term]
    if (!members || members.length === 0) continue

    const xs = members.map((n) => n.position.x)
    const minX = Math.min(...xs) - PAD_X
    const maxX = Math.max(...xs) + NODE_W + PAD_X

    groupNodes.push({
      id: `term-${term}`,
      type: 'termGroup',
      position: { x: minX, y: globalMinY - PAD_TOP },
      data: { labels: [term], tier: 'foundation' as Tier, courseTitle: '', courseUrl: '', courseReason: '', courseUnits: 0, term, termCredits: members.reduce((s, n) => s + (n.data.courseUnits ?? 0.5), 0) },
      style: { width: maxX - minX, height: (globalMaxY - globalMinY) + PAD_TOP + PAD_BOTTOM },
      selectable: false,
      draggable: false,
    } as Node<SkillNodeData>)
  }

  // Groups rendered first (behind), then course nodes on top
  return [...groupNodes, ...courseNodes]
}

function toFlowEdges(apiEdges: ApiEdge[], edgeType = 'smoothstep', extraData?: Record<string, unknown>): Edge[] {
  return apiEdges.map((e) => ({
    ...e,
    style: { stroke: '#d6d3d1', strokeWidth: 1.5 },
    type: edgeType,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#d6d3d1', width: 14, height: 14 },
    ...(extraData ? { data: extraData } : {}),
  }))
}


/* ─── Graph Page ─── */

export default function Graph() {
  const location = useLocation()
  const navigate = useNavigate()
  const navState = (location.state ?? {}) as Record<string, unknown>
  const mode = (navState.mode as string) ?? 'career'

  // Career-mode fields
  const navGoal = navState.goal as string | undefined
  const existingSkills = navState.existingSkills as { raw: string; esco_label: string; esco_uri: string | null }[] | undefined
  const navDesiredSkills = navState.desiredSkills as { raw: string; esco_label: string; esco_uri: string | null }[] | undefined
  const jobUrl = navState.jobUrl as string | undefined

  // Academics-mode fields
  const requirementGroups = navState.requirementGroups as { rule: string | number; courses: { code: string; title: string; units: number | null }[] }[] | undefined
  const specializations = navState.specializations as { pid: string }[] | undefined
  const minors = navState.minors as { pid: string }[] | undefined
  const major = navState.major as { title: string; faculty: string } | undefined

  const [nodes, setNodes] = useState<Node<SkillNodeData>[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [goal, setGoal] = useState('')
  const [desiredSkills, setDesiredSkills] = useState<string[]>(() =>
    (navDesiredSkills ?? []).map((s) => s.esco_label),
  )
  const [mySkills, setMySkills] = useState<string[]>(() =>
    (existingSkills ?? []).map((s) => s.esco_label),
  )
  const [loading, setLoading] = useState(true)
  const [courseHistory, setCourseHistory] = useState<HistoryEntry[]>([])
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const regenAbortRef = useRef<AbortController | null>(null)
  const skillChangeCounter = useRef(0)
  const dragCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ROW_GAP = 220

  const displayEdges = useMemo(() => {
    if (mode !== 'academics') return edges
    if (!hoveredNodeId) return edges.map((e) => ({ ...e, hidden: true }))
    return edges.map((e) => ({
      ...e,
      hidden: e.source !== hoveredNodeId && e.target !== hoveredNodeId,
      style: { stroke: '#a8a29e', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#a8a29e', width: 14, height: 14 },
    }))
  }, [edges, hoveredNodeId, mode])

  const handleNodeDrag = useCallback((_: React.MouseEvent, draggedNode: Node<SkillNodeData>) => {
    if (!draggedNode.data.term) return
    const term = draggedNode.data.term as string

    setNodes((prev) => {
      const courseNodes = prev.filter((n) => n.type === 'skill')
      const sameTerm = courseNodes
        .filter((n) => n.data.term === term && n.id !== draggedNode.id)
        .sort((a, b) => a.position.y - b.position.y)

      const insertAt = sameTerm.findIndex((n) => n.position.y > draggedNode.position.y)
      const newOrder = [...sameTerm]
      if (insertAt === -1) newOrder.push(draggedNode)
      else newOrder.splice(insertAt, 0, draggedNode)

      const posMap: Record<string, number> = {}
      newOrder.forEach((n, i) => { if (n.id !== draggedNode.id) posMap[n.id] = i * ROW_GAP })

      return prev.map((n) => {
        if (n.type !== 'skill' || n.id === draggedNode.id) return n
        const newY = posMap[n.id]
        if (newY === undefined || n.position.y === newY) return n
        return { ...n, position: { x: n.position.x, y: newY }, style: { ...n.style, transition: 'transform 150ms ease' } }
      })
    })
  }, [])

  const handleNodeDragStop = useCallback((_: React.MouseEvent, draggedNode: Node<SkillNodeData>) => {
    if (!draggedNode.data.term) return

    setNodes((prev) => {
      const groupNodes = prev.filter((n) => n.type === 'termGroup')
      const courseNodes = prev.filter((n) => n.type === 'skill')

      // Find which term box the node's center landed in
      const cx = draggedNode.position.x + NODE_W / 2
      const cy = draggedNode.position.y + NODE_H / 2
      let targetTerm = draggedNode.data.term as string
      for (const tg of groupNodes) {
        const w = Number((tg.style as Record<string, unknown>)?.width ?? 0)
        const h = Number((tg.style as Record<string, unknown>)?.height ?? 0)
        if (cx >= tg.position.x && cx <= tg.position.x + w &&
            cy >= tg.position.y && cy <= tg.position.y + h) {
          targetTerm = tg.data.term as string
          break
        }
      }

      const oldTerm = draggedNode.data.term as string

      // Enforce 3.25 credit cap when moving to a different term
      if (targetTerm !== oldTerm) {
        const targetCredits = courseNodes
          .filter((n) => n.data.term === targetTerm)
          .reduce((s, n) => s + (n.data.courseUnits ?? 0.5), 0)
        if (targetCredits + (draggedNode.data.courseUnits ?? 0.5) > 3.25) return prev
      }

      // Snap X to the term column (use existing nodes in that term, or fall back to group node)
      const existingInTarget = courseNodes.find((n) => n.data.term === targetTerm && n.id !== draggedNode.id)
      const snapX = existingInTarget?.position.x
        ?? (groupNodes.find((n) => n.data.term === targetTerm)?.position.x ?? draggedNode.position.x) + 20

      // Build new ordered list for target term (insert by Y)
      const targetCourses = courseNodes
        .filter((n) => n.data.term === targetTerm && n.id !== draggedNode.id)
        .sort((a, b) => a.position.y - b.position.y)
      const insertAt = targetCourses.findIndex((n) => n.position.y > draggedNode.position.y)
      const newTargetOrder = [...targetCourses]
      if (insertAt === -1) newTargetOrder.push(draggedNode)
      else newTargetOrder.splice(insertAt, 0, draggedNode)

      // Build new ordered list for old term (remove dragged)
      const oldCourses = oldTerm === targetTerm
        ? []
        : courseNodes
            .filter((n) => n.data.term === oldTerm && n.id !== draggedNode.id)
            .sort((a, b) => a.position.y - b.position.y)
      const oldSnapX = courseNodes.find((n) => n.data.term === oldTerm && n.id !== draggedNode.id)?.position.x
        ?? draggedNode.position.x

      // Build position map
      const posMap: Record<string, { x: number; y: number; term: string }> = {}
      newTargetOrder.forEach((n, i) => { posMap[n.id] = { x: snapX, y: i * ROW_GAP, term: targetTerm } })
      if (oldTerm !== targetTerm) {
        oldCourses.forEach((n, i) => { posMap[n.id] = { x: oldSnapX, y: i * ROW_GAP, term: oldTerm } })
      }

      return prev.map((n) => {
        if (n.type !== 'skill') return n
        const p = posMap[n.id]
        if (!p) return n
        return { ...n, data: { ...n.data, term: p.term }, position: { x: p.x, y: p.y } }
      })
    })

    // Strip transitions after animation completes
    if (dragCleanupRef.current) clearTimeout(dragCleanupRef.current)
    dragCleanupRef.current = setTimeout(() => {
      setNodes((prev) => prev.map((n) => {
        if (n.type !== 'skill' || !(n.style as Record<string, unknown>)?.transition) return n
        const { transition: _, ...rest } = n.style as Record<string, unknown>
        return { ...n, style: rest as React.CSSProperties }
      }))
    }, 200)
  }, [])

  const fetchAcademicGraph = useCallback(() => {
    regenAbortRef.current?.abort()
    const controller = new AbortController()
    regenAbortRef.current = controller
    setLoading(true)
    setNodes([])
    setEdges([])

    fetch('/api/graph/academics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requirement_groups: requirementGroups ?? [],
        specialization_pids: (specializations ?? []).map((s) => s.pid),
        minor_pids: (minors ?? []).map((m) => m.pid),
        goal: navGoal ?? '',
      }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: ApiGraph) => {
        const courseNodes = toFlowNodes(data.nodes)
        const termByNode: Record<string, string> = {}
        courseNodes.forEach((n) => { termByNode[n.id] = n.data.term as string })
        const flowEdges = toFlowEdges(
          data.edges.filter((e) => termByNode[e.source] !== termByNode[e.target]),
          'academicEdge',
        )
        setNodes(addTermGroups(courseNodes))
        setEdges(flowEdges)
        setGoal(data.goal)
      })
      .then(() => setLoading(false))
      .catch((e) => {
        if (e.name === 'AbortError') return
        setLoading(false)
      })
  }, [navGoal, requirementGroups, specializations, minors])

  const fetchGraph = useCallback((existing: string[], desired: string[]) => {
    regenAbortRef.current?.abort()
    const controller = new AbortController()
    regenAbortRef.current = controller
    setLoading(true)
    setNodes([])
    setEdges([])

    fetch('/api/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: navGoal ?? '',
        existing_skills: existing,
        desired_skills: desired,
        job_url: jobUrl ?? '',
      }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: ApiGraph) => {
        const flowEdges = toFlowEdges(data.edges)
        setNodes(layoutGraph(toFlowNodes(data.nodes), flowEdges))
        setEdges(flowEdges)
        setGoal(data.goal)
      })
      .then(() => setLoading(false))
      .catch((e) => {
        if (e.name === 'AbortError') return
        setLoading(false)
      })
  }, [navGoal, jobUrl])

  // Initial load
  useEffect(() => {
    if (mode === 'academics') {
      fetchAcademicGraph()
    } else {
      fetchGraph(
        (existingSkills ?? []).map((s) => s.esco_label),
        (navDesiredSkills ?? []).map((s) => s.esco_label),
      )
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDesiredSkillsChange = useCallback((newSkills: string[]) => {
    setDesiredSkills(newSkills)
    skillChangeCounter.current += 1
    const snapshot = skillChangeCounter.current
    setTimeout(() => {
      if (skillChangeCounter.current === snapshot) {
        fetchGraph(mySkills, newSkills)
      }
    }, 0)
  }, [fetchGraph, mySkills])

  const handleMySkillsChange = useCallback((newSkills: string[]) => {
    setMySkills(newSkills)
    skillChangeCounter.current += 1
    const snapshot = skillChangeCounter.current
    setTimeout(() => {
      if (skillChangeCounter.current === snapshot) {
        fetchGraph(newSkills, desiredSkills)
      }
    }, 0)
  }, [fetchGraph, desiredSkills])

  const onNodesChange: OnNodesChange<Node<SkillNodeData>> = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  )

  return (
    <CourseProvider edges={edges} setNodes={setNodes} onCourseReplaced={(entry) => setCourseHistory((h) => [entry, ...h])}>
      {/* Mobile: column layout (panels on top, graph below). Desktop: absolute overlays on full-screen graph */}
      <div className="relative w-screen h-dvh">

        {/* Panels — absolute overlays on all sizes, pointer-events-none container */}
        <div className="absolute inset-0 z-10 overflow-visible pointer-events-none">
          <div className="absolute top-3 left-3 right-3 flex flex-col gap-2 pointer-events-auto sm:top-5 sm:left-5 sm:right-auto sm:gap-3">
            <GoalPanel goal={navGoal ?? goal} program={mode === 'academics' ? major : undefined} />
            {mode === 'academics' && (
              <GoalPanel goal={navGoal ?? goal} />
            )}
            {mode !== 'academics' && (
              <>
                <DesiredSkillsPanel skills={desiredSkills} onSkillsChange={handleDesiredSkillsChange} loading={loading} />
                <MySkillsPanel skills={mySkills} onSkillsChange={handleMySkillsChange} loading={loading} />
              </>
            )}
          </div>

          <div className="hidden pointer-events-auto sm:flex sm:flex-col sm:gap-3 sm:absolute sm:top-5 sm:right-5">
            <CourseHistoryPanel
              history={courseHistory}
              onRestore={(index) => {
                const entry = courseHistory[index]
                setNodes((nds) =>
                  nds.map((n) =>
                    n.data.labels.includes(entry.skill)
                      ? { ...n, data: { ...n.data, courseTitle: entry.oldCourse } }
                      : n,
                  ),
                )
                setCourseHistory((h) => h.filter((_, i) => i !== index))
              }}
            />
          </div>
        </div>

        {/* Graph — full screen, user pans freely */}
        <div className="relative w-full h-full">
          {loading && (
            <div className="absolute inset-x-0 bottom-0 top-[60%] sm:top-0 z-[15] flex flex-col items-center justify-center gap-3 pointer-events-none">
              <Loader2 size={28} className="text-blue-800 animate-spin" />
              <p className="text-stone-400 text-sm">{mode === 'academics' ? 'Building your course graph…' : 'Building your skill tree…'}</p>
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onNodeDrag={handleNodeDrag}
            onNodeDragStop={handleNodeDragStop}
            onNodeMouseEnter={(_, node) => mode === 'academics' && setHoveredNodeId(node.id)}
            onNodeMouseLeave={() => mode === 'academics' && setHoveredNodeId(null)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            nodesConnectable={false}
            panOnDrag
            zoomOnScroll
            style={{ background: '#fafaf9' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e7e5e4" />
          </ReactFlow>
        </div>

        {/* Summary FAB — bottom-left */}
        <button
          onClick={() => {
            const courseNodes = nodes
              .filter((n) => n.type === 'skill')
              .map((n) => ({
                id: n.id,
                labels: n.data.labels,
                courseTitle: n.data.courseTitle,
                courseUrl: n.data.courseUrl,
                courseReason: n.data.courseReason,
                tier: n.data.tier,
                term: n.data.term,
              }))
            navigate('/summary', {
              state: { goal: navGoal ?? goal, mode, program: mode === 'academics' ? major : undefined, courses: courseNodes },
            })
          }}
          disabled={loading || nodes.filter((n) => n.type === 'skill').length === 0}
          className="fab-enter fixed bottom-8 left-6 z-20 h-11 pl-3.5 pr-4 rounded-full bg-stone-900 text-white shadow-md hover:shadow-lg hover:bg-stone-800 active:scale-[0.97] disabled:opacity-0 disabled:pointer-events-none cursor-pointer transition-all duration-200 flex items-center gap-2"
          aria-label="View Summary"
        >
          <FileText size={16} />
          <span className="text-[13px] font-medium">Summary</span>
        </button>

        <GoatChat
          context={{
            goal: navGoal ?? goal,
            desired_skills: desiredSkills,
            my_skills: mySkills,
            nodes: nodes.map((n) => ({ skill: n.data.labels.join(', '), course_title: n.data.courseTitle })),
            mode,
          }}
          onAction={(action) => {
            switch (action.type) {
              case 'replace_course':
                if (action.skill_name && action.course) {
                  const oldNode = nodes.find((n) => n.data.labels.includes(action.skill_name!))
                  if (oldNode) {
                    setCourseHistory((h) => [{ skill: action.skill_name!, oldCourse: oldNode.data.courseTitle, newCourse: action.course!.title }, ...h])
                  }
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.data.labels.includes(action.skill_name!)
                        ? { ...n, data: { ...n.data, courseTitle: action.course!.title, courseUrl: action.course!.url, courseReason: action.course!.reason ?? '' } }
                        : n,
                    ),
                  )
                }
                break
              case 'add_my_skill':
                if (action.skill_name && mode !== 'academics') handleMySkillsChange([...mySkills, action.skill_name])
                break
              case 'remove_my_skill':
                if (action.skill_name && mode !== 'academics') handleMySkillsChange(mySkills.filter((s) => s !== action.skill_name))
                break
              case 'add_desired_skill':
                if (action.skill_name && mode !== 'academics') handleDesiredSkillsChange([...desiredSkills, action.skill_name])
                break
              case 'remove_desired_skill':
                if (action.skill_name && mode !== 'academics') handleDesiredSkillsChange(desiredSkills.filter((s) => s !== action.skill_name))
                break
            }
          }}
        />
      </div>
    </CourseProvider>
  )
}
