import { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react'
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
import { ExternalLink, Pencil, Check, X, RefreshCw, ChevronDown } from 'lucide-react'

/* ─── Layout helpers ─── */

const NODE_W = 260
const GAP_X = 290
const GAP_Y = 220

function col(c: number) { return c * GAP_X }
function row(r: number) { return r * GAP_Y }

/* ─── Types ─── */

type Tier = 'foundation' | 'core' | 'advanced' | 'specialization'
type CourseStatus = 'pending' | 'accepted' | 'replacing' | 'replaced'

interface SkillNodeData {
  label: string
  courseTitle: string
  courseUrl: string
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
  accept: (nodeId: string) => void
  startReplace: (nodeId: string) => void
  submitReplace: (nodeId: string, reason: string) => void
  cancelReplace: (nodeId: string) => void
}

const CourseContext = createContext<CourseContextValue>(null!)

function CourseProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<Record<string, CourseState>>({})

  const accept = useCallback((nodeId: string) => {
    setStore((s) => ({ ...s, [nodeId]: { status: 'accepted' } }))
  }, [])

  const startReplace = useCallback((nodeId: string) => {
    setStore((s) => ({ ...s, [nodeId]: { status: 'replacing' } }))
  }, [])

  const submitReplace = useCallback((nodeId: string, reason: string) => {
    setStore((s) => ({ ...s, [nodeId]: { status: 'replaced', reason } }))
  }, [])

  const cancelReplace = useCallback((nodeId: string) => {
    setStore((s) => {
      const copy = { ...s }
      delete copy[nodeId]
      return copy
    })
  }, [])

  return (
    <CourseContext.Provider value={{ store, accept, startReplace, submitReplace, cancelReplace }}>
      {children}
    </CourseContext.Provider>
  )
}

function useCourse(nodeId: string) {
  const ctx = useContext(CourseContext)
  const state: CourseState = ctx.store[nodeId] ?? { status: 'pending' }
  return { state, ...ctx }
}

/* ─── Skill Node ─── */

function SkillNode({ id, data }: NodeProps<Node<SkillNodeData>>) {
  const config = tierConfig[data.tier]
  const { state, accept, startReplace, submitReplace, cancelReplace } = useCourse(id)
  const [reason, setReason] = useState('')

  const isAccepted = state.status === 'accepted'
  const isReplacing = state.status === 'replacing'
  const isReplaced = state.status === 'replaced'
  const borderClass = isAccepted || isReplaced ? config.borderAccepted : config.border

  return (
    <div
      className={`bg-white rounded-xl border-2 ${borderClass} hover:-translate-y-0.5 transition-all duration-200`}
      style={{ width: NODE_W, padding: '14px 16px' }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <span className={`block text-[10px] font-semibold uppercase tracking-wide ${config.text} mb-1`}>
        {config.label}
      </span>

      <span className="block text-[15px] font-semibold text-stone-900 leading-tight mb-2.5">
        {data.label}
      </span>

      <span className="block text-[9px] font-medium uppercase tracking-wider text-stone-400 mb-0.5">
        Recommended course
      </span>

      <a
        className="nodrag nopan inline-flex items-center gap-1 text-xs text-stone-500 no-underline hover:text-stone-900 transition-colors duration-150 cursor-pointer"
        href={data.courseUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ maxWidth: NODE_W - 52 }}
      >
        <ExternalLink size={12} className="shrink-0" />
        <span className="truncate">{data.courseTitle}</span>
      </a>

      {/* Completed / Replace buttons */}
      {state.status === 'pending' && (
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

      {/* Completed badge */}
      {isAccepted && (
        <div className="flex items-center gap-1 mt-3 text-[11px] font-medium text-emerald-600">
          <Check size={12} />
          Completed
        </div>
      )}

      {/* Replace form */}
      {isReplacing && (
        <div className="flex flex-col gap-1.5 mt-3 nodrag">
          <textarea
            className="nopan w-full border border-stone-300 rounded-lg px-2 py-1.5 text-xs text-stone-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 resize-none transition-all duration-150"
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
              onClick={() => { submitReplace(id, reason); setReason('') }}
              className="nopan px-2 py-1 text-[11px] font-medium rounded-lg bg-teal-700 text-white hover:bg-teal-800 cursor-pointer transition-colors duration-150"
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {/* Replaced badge */}
      {isReplaced && (
        <div className="mt-3">
          <div className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
            <RefreshCw size={12} />
            Replacement requested
          </div>
          {state.reason && (
            <p className="text-[11px] text-stone-500 mt-0.5 leading-snug">{state.reason}</p>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  )
}

const nodeTypes = { skill: SkillNode }

/* ─── Goal Panel ─── */

function GoalPanel() {
  const [goal, setGoal] = useState('Break into computer vision engineering')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(goal)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  function save() {
    const trimmed = draft.trim()
    if (trimmed) setGoal(trimmed)
    setEditing(false)
  }

  function cancel() {
    setDraft(goal)
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() }
    if (e.key === 'Escape') cancel()
  }

  return (
    <div className="w-80 bg-white rounded-xl shadow-lg border border-stone-200 p-4 hover:shadow-xl transition-shadow duration-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          Goal
        </span>
        {!editing && (
          <button
            onClick={() => { setDraft(goal); setEditing(true) }}
            className="p-1 rounded-md text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors duration-150 cursor-pointer"
            aria-label="Edit goal"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            ref={inputRef}
            className="w-full border border-stone-300 rounded-lg px-2.5 py-2 text-sm text-stone-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 resize-none transition-all duration-150"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
          />
          <div className="flex gap-1.5 justify-end">
            <button
              onClick={cancel}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-stone-200 rounded-lg bg-white text-stone-500 hover:bg-stone-50 cursor-pointer transition-colors duration-150"
            >
              <X size={12} />
              Cancel
            </button>
            <button
              onClick={save}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border-none rounded-lg bg-teal-700 text-white hover:bg-teal-800 cursor-pointer transition-colors duration-150"
            >
              <Check size={12} />
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className="text-base font-medium text-stone-900 m-0 leading-snug">
          {goal}
        </p>
      )}
    </div>
  )
}

/* ─── Required Skills Panel ─── */

const ALL_SKILLS = [
  'Linear Algebra', 'Calculus', 'Python', 'Probability & Statistics',
  'Neural Networks', 'Image Processing', 'Deep Learning', 'CNNs',
  'Object Detection', 'Image Segmentation',
  'PyTorch', 'TensorFlow', 'OpenCV', 'NumPy', 'Data Augmentation',
  'Transfer Learning', 'GANs', 'Reinforcement Learning', 'NLP',
]

function RequiredSkillsPanel() {
  const [skills, setSkills] = useState<string[]>([
    'Linear Algebra', 'Calculus', 'Python', 'Probability & Statistics',
    'Neural Networks', 'Image Processing', 'Deep Learning', 'CNNs',
    'Object Detection', 'Image Segmentation',
  ])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const suggestions = ALL_SKILLS.filter(
    (s) => !skills.includes(s) && s.toLowerCase().includes(query.toLowerCase()),
  )

  function addSkill(skill: string) {
    setSkills((prev) => [...prev, skill])
    setQuery('')
    setOpen(false)
    inputRef.current?.focus()
  }

  function removeSkill(skill: string) {
    setSkills((prev) => prev.filter((s) => s !== skill))
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
    // Use setTimeout so the current click that opened the dropdown doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick, true)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick, true)
    }
  }, [open])

  return (
    <div className="w-80 bg-white rounded-xl shadow-lg border border-stone-200 p-4 hover:shadow-xl transition-shadow duration-200">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-3">
        Required Skills
      </span>

      {/* Chips */}
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

      {/* Input with dropdown */}
      <div className="relative">
        <div className="flex items-center border border-stone-300 rounded-lg overflow-hidden focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/15 transition-all duration-150">
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

        {open && suggestions.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 right-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg max-h-40 overflow-y-auto z-20"
          >
            {suggestions.map((skill) => (
              <button
                key={skill}
                onClick={() => addSkill(skill)}
                className="w-full text-left px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 cursor-pointer transition-colors duration-100"
              >
                {skill}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Data ─── */

const initialNodes: Node<SkillNodeData>[] = [
  { id: 'lin-alg',   type: 'skill', position: { x: col(0), y: row(0) }, data: { label: 'Linear Algebra',          tier: 'foundation',     courseTitle: '3Blue1Brown — Essence of Linear Algebra', courseUrl: 'https://www.youtube.com/playlist?list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab' } },
  { id: 'calculus',  type: 'skill', position: { x: col(1), y: row(0) }, data: { label: 'Calculus',                 tier: 'foundation',     courseTitle: '3Blue1Brown — Essence of Calculus',       courseUrl: 'https://www.youtube.com/playlist?list=PLZHQObOWTQDMsr9K-rj53DwVRMYO3t5Yr' } },
  { id: 'python',    type: 'skill', position: { x: col(2), y: row(0) }, data: { label: 'Python',                   tier: 'foundation',     courseTitle: 'MIT 6.100L — Intro to CS with Python',    courseUrl: 'https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/' } },
  { id: 'prob-stat', type: 'skill', position: { x: col(3), y: row(0) }, data: { label: 'Probability & Statistics', tier: 'foundation',     courseTitle: 'Khan Academy — Statistics & Probability',  courseUrl: 'https://www.khanacademy.org/math/statistics-probability' } },

  { id: 'nn',        type: 'skill', position: { x: col(0.5), y: row(1) }, data: { label: 'Neural Networks',        tier: 'core',           courseTitle: '3Blue1Brown — Neural Networks',            courseUrl: 'https://www.youtube.com/playlist?list=PLZHQObOWTQDNU6R1_67000Dx_ZCJB-3pi' } },
  { id: 'img-proc',  type: 'skill', position: { x: col(2.5), y: row(1) }, data: { label: 'Image Processing',      tier: 'core',           courseTitle: 'Duke — Image and Video Processing',       courseUrl: 'https://www.coursera.org/learn/image-processing' } },

  { id: 'dl',        type: 'skill', position: { x: col(0.5), y: row(2) }, data: { label: 'Deep Learning',          tier: 'advanced',       courseTitle: 'fast.ai — Practical Deep Learning',       courseUrl: 'https://course.fast.ai/' } },
  { id: 'cnn',       type: 'skill', position: { x: col(2.5), y: row(2) }, data: { label: 'CNNs',                   tier: 'advanced',       courseTitle: 'Stanford CS231n — CNNs for Visual Recognition', courseUrl: 'https://cs231n.stanford.edu/' } },

  { id: 'obj-det',   type: 'skill', position: { x: col(0.5), y: row(3) }, data: { label: 'Object Detection',      tier: 'specialization', courseTitle: 'Learn OpenCV — Object Detection Guide',   courseUrl: 'https://learnopencv.com/object-detection-using-yolov5-and-opencv-dnn-in-cpp-and-python/' } },
  { id: 'img-seg',   type: 'skill', position: { x: col(2.5), y: row(3) }, data: { label: 'Image Segmentation',    tier: 'specialization', courseTitle: 'HuggingFace — Segmentation with Transformers', courseUrl: 'https://huggingface.co/docs/transformers/tasks/semantic_segmentation' } },
]

const edges: Edge[] = [
  { id: 'e-la-nn',   source: 'lin-alg',   target: 'nn' },
  { id: 'e-calc-nn', source: 'calculus',   target: 'nn' },
  { id: 'e-la-ip',   source: 'lin-alg',    target: 'img-proc' },
  { id: 'e-py-ip',   source: 'python',     target: 'img-proc' },
  { id: 'e-nn-dl',   source: 'nn',         target: 'dl' },
  { id: 'e-ip-cnn',  source: 'img-proc',   target: 'cnn' },
  { id: 'e-dl-cnn',  source: 'dl',         target: 'cnn' },
  { id: 'e-cnn-od',  source: 'cnn',        target: 'obj-det' },
  { id: 'e-cnn-is',  source: 'cnn',        target: 'img-seg' },
]

const styledEdges: Edge[] = edges.map((e) => ({
  ...e,
  style: { stroke: '#d6d3d1', strokeWidth: 1.5 },
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, color: '#d6d3d1', width: 14, height: 14 },
}))

/* ─── App ─── */

export default function App() {
  const [nodes, setNodes] = useState(initialNodes)

  const onNodesChange: OnNodesChange<Node<SkillNodeData>> = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  )

  return (
    <CourseProvider>
      <div className="w-screen h-screen relative">
        <div className="absolute top-5 left-5 z-10 flex flex-col gap-3">
          <GoalPanel />
          <RequiredSkillsPanel />
        </div>
        <ReactFlow
          nodes={nodes}
          edges={styledEdges}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          panOnDrag
          zoomOnScroll
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e7e5e4" />
        </ReactFlow>
      </div>
    </CourseProvider>
  )
}
