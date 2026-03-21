import { useState, useRef, useEffect, useCallback, useMemo, createContext, useContext } from 'react'
import { useLocation } from 'react-router-dom'
import {
  ReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type OnNodesChange,
  Handle,
  Position,
  Background,
  BackgroundVariant,
  MarkerType,
  applyNodeChanges,
} from '@xyflow/react'
import { ExternalLink, Check, X, RefreshCw, ChevronDown, Loader2, Undo2, HelpCircle } from 'lucide-react'
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
  label: string
  courseTitle: string
  courseUrl: string
  courseReason: string
  tier: Tier
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
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <div className={locked ? 'opacity-40' : ''}>
      <span className={`block text-[10px] font-semibold uppercase tracking-wide ${config.text} mb-1`}>
        {config.label}
      </span>

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
            Skill
          </span>
          <span className="block text-xs text-stone-400">
            {data.label}
          </span>
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
              onClick={() => { submitReplace(id, reason, data.label, data.courseTitle); setReason('') }}
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

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

const nodeTypes = { skill: SkillNode }

/* ─── Goal Panel ─── */

function GoalPanel({ goal }: { goal: string }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="w-full sm:w-80 bg-white rounded-xl shadow-lg border border-stone-200 p-3 sm:p-4 hover:shadow-xl transition-shadow duration-200">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer"
      >
        <ChevronDown size={14} className={`text-stone-400 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          Goal
        </span>
      </button>

      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
      >
        <div className="overflow-hidden">
          <div className="pt-2">
            <p className="text-sm sm:text-base font-medium text-stone-900 m-0 leading-snug">
              {goal}
            </p>
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

interface ApiCourse { title: string; url: string; reason: string }
interface ApiNode { id: string; label: string; tier: string; course: ApiCourse; position: { x: number; y: number } }
interface ApiEdge { id: string; source: string; target: string }
interface ApiGraph { goal: string; skills: string[]; nodes: ApiNode[]; edges: ApiEdge[] }

function toFlowNodes(apiNodes: ApiNode[]): Node<SkillNodeData>[] {
  return apiNodes.map((n) => ({
    id: n.id,
    type: 'skill',
    position: n.position,
    data: {
      label: n.label,
      tier: n.tier as Tier,
      courseTitle: n.course.title,
      courseUrl: n.course.url,
      courseReason: n.course.reason ?? '',
    },
  }))
}

function toFlowEdges(apiEdges: ApiEdge[]): Edge[] {
  return apiEdges.map((e) => ({
    ...e,
    style: { stroke: '#d6d3d1', strokeWidth: 1.5 },
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#d6d3d1', width: 14, height: 14 },
  }))
}

/* ─── Graph Page ─── */

export default function Graph() {
  const location = useLocation()
  const { goal: navGoal, existingSkills, desiredSkills: navDesiredSkills, jobUrl } = (location.state ?? {}) as {
    goal?: string
    existingSkills?: { raw: string; esco_label: string; esco_uri: string | null }[]
    desiredSkills?: { raw: string; esco_label: string; esco_uri: string | null }[]
    jobUrl?: string
  }

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
  const regenAbortRef = useRef<AbortController | null>(null)
  const skillChangeCounter = useRef(0)
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
    fetchGraph(
      (existingSkills ?? []).map((s) => s.esco_label),
      (navDesiredSkills ?? []).map((s) => s.esco_label),
    )
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
            <GoalPanel goal={navGoal ?? goal} />
            <DesiredSkillsPanel skills={desiredSkills} onSkillsChange={handleDesiredSkillsChange} loading={loading} />
            <MySkillsPanel skills={mySkills} onSkillsChange={handleMySkillsChange} loading={loading} />
          </div>

          <div className="hidden pointer-events-auto sm:block sm:absolute sm:top-5 sm:right-5">
            <CourseHistoryPanel
              history={courseHistory}
              onRestore={(index) => {
                const entry = courseHistory[index]
                setNodes((nds) =>
                  nds.map((n) =>
                    n.data.label === entry.skill
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
            <div className="absolute inset-0 z-[15] flex flex-col items-center justify-center gap-3 pointer-events-none">
              <Loader2 size={28} className="text-blue-800 animate-spin" />
              <p className="text-stone-400 text-sm">Building your skill tree…</p>
            </div>
          )}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
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

        <GoatChat
          context={{
            goal: navGoal ?? goal,
            desired_skills: desiredSkills,
            my_skills: mySkills,
            nodes: nodes.map((n) => ({ skill: n.data.label, course_title: n.data.courseTitle })),
          }}
          onAction={(action) => {
            switch (action.type) {
              case 'replace_course':
                if (action.skill_name && action.course) {
                  const oldNode = nodes.find((n) => n.data.label === action.skill_name)
                  if (oldNode) {
                    setCourseHistory((h) => [{ skill: action.skill_name!, oldCourse: oldNode.data.courseTitle, newCourse: action.course!.title }, ...h])
                  }
                  setNodes((nds) =>
                    nds.map((n) =>
                      n.data.label === action.skill_name
                        ? { ...n, data: { ...n.data, courseTitle: action.course!.title, courseUrl: action.course!.url, courseReason: action.course!.reason ?? '' } }
                        : n,
                    ),
                  )
                }
                break
              case 'add_my_skill':
                if (action.skill_name) handleMySkillsChange([...mySkills, action.skill_name])
                break
              case 'remove_my_skill':
                if (action.skill_name) handleMySkillsChange(mySkills.filter((s) => s !== action.skill_name))
                break
              case 'add_desired_skill':
                if (action.skill_name) handleDesiredSkillsChange([...desiredSkills, action.skill_name])
                break
              case 'remove_desired_skill':
                if (action.skill_name) handleDesiredSkillsChange(desiredSkills.filter((s) => s !== action.skill_name))
                break
            }
          }}
        />
      </div>
    </CourseProvider>
  )
}
