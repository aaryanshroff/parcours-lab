import { useState, useRef, useEffect } from 'react'
import { Send, X, Loader2 } from 'lucide-react'
import goatImg from '../assets/mountain-goat.png'

interface SearchResult {
  code: string
  title: string
  url: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  searchResults?: { courseCode: string; results: SearchResult[] }
}

interface ChatAction {
  type: string
  skill_name?: string
  course?: { title: string; url: string; reason?: string }
  course_code?: string
  results?: SearchResult[]
}

interface ChatContext {
  goal: string
  desired_skills: string[]
  my_skills: string[]
  nodes: { skill: string; course_title: string }[]
  mode?: string
}

interface GoatChatProps {
  context: ChatContext
  onAction: (action: ChatAction) => void
}

export default function GoatChat({ context, onAction }: GoatChatProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hey! I'm your learning path guide. Ask me anything about your skill tree!" },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  async function send() {
    const text = input.trim()
    if (!text || loading) return

    const next: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, context }),
      })
      const data = await res.json()

      // Separate search_results from other actions
      let searchResults: Message['searchResults'] = undefined
      if (data.actions) {
        for (const action of data.actions as ChatAction[]) {
          if (action.type === 'search_results' && action.results) {
            searchResults = { courseCode: action.course_code ?? '', results: action.results }
          } else {
            onAction(action)
          }
        }
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: data.message, searchResults }])
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Something went wrong. Try again.' }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="fixed bottom-4 right-3 left-3 sm:left-auto sm:right-4 z-50 flex flex-col items-end">
      {open && (
        <div className="mb-2 w-full sm:w-80 h-80 sm:h-96 bg-white rounded-xl shadow-lg border border-stone-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-stone-100">
            <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Ask the Goat
            </span>
            <button
              onClick={() => setOpen(false)}
              className="p-1 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 cursor-pointer transition-colors duration-150"
            >
              <X size={14} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {messages.map((msg, i) => (
              <div key={i}>
                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-1.5 text-sm leading-snug ${
                      msg.role === 'user'
                        ? 'bg-blue-900 text-white'
                        : 'bg-stone-100 text-stone-800'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
                {msg.searchResults && (
                  <div className="mt-1.5 space-y-0.5">
                    {msg.searchResults.results.map((r) => (
                      <button
                        key={r.code}
                        onClick={() => {
                          onAction({
                            type: 'replace_course',
                            skill_name: msg.searchResults!.courseCode,
                            course: { title: `${r.code}: ${r.title}`, url: r.url },
                          })
                          setMessages((prev) => [
                            ...prev,
                            { role: 'assistant', content: `Replaced with ${r.code}: ${r.title}` },
                          ])
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm rounded-md border border-stone-200 bg-white hover:bg-blue-50 hover:border-blue-300 transition-colors duration-150 cursor-pointer"
                      >
                        <span className="font-semibold text-blue-900">{r.code}</span>
                        <span className="text-stone-600"> — {r.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-stone-100 rounded-lg px-3 py-1.5">
                  <Loader2 size={14} className="text-stone-400 animate-spin" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-stone-100 px-3 py-2">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                placeholder="Type a message..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 text-base sm:text-sm text-stone-900 outline-none bg-transparent placeholder:text-stone-400"
              />
              <button
                onClick={send}
                disabled={!input.trim() || loading}
                className="p-1.5 rounded-lg text-blue-900 hover:bg-blue-50 disabled:opacity-30 disabled:cursor-default cursor-pointer transition-colors duration-150"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Goat toggle - clicking opens/closes chat */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative cursor-pointer bg-transparent border-none p-0"
      >
        <img src={goatImg} alt="Goat mascot" className="h-20 w-20 sm:h-28 sm:w-28 object-contain" />
        {!open && (
          <span className="absolute top-0 left-0 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
          </span>
        )}
      </button>
    </div>
  )
}
