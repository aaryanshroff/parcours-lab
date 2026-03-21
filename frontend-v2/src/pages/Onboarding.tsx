import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Upload, Link, Loader2, X, Plus } from 'lucide-react'


interface EscoSkill {
  raw: string
  esco_label: string
  esco_uri: string | null
}

export default function Onboarding() {
  const navigate = useNavigate()
  const [goal, setGoal] = useState('')
  const [jobUrl, setJobUrl] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [resumeSkills, setResumeSkills] = useState<EscoSkill[]>([])
  const [skillInput, setSkillInput] = useState('')
  const [dragging, setDragging] = useState(false)
  const [goalExistingSkills, setGoalExistingSkills] = useState<EscoSkill[]>([])
  const [goalDesiredSkills, setGoalDesiredSkills] = useState<EscoSkill[]>([])
  const [goalParsing, setGoalParsing] = useState(false)
  const [jobSkills, setJobSkills] = useState<EscoSkill[]>([])
  const [jobParsing, setJobParsing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const goalAbortRef = useRef<AbortController | null>(null)
  const jobAbortRef = useRef<AbortController | null>(null)

  // Debounced goal skill extraction
  useEffect(() => {
    const trimmed = goal.trim()
    if (trimmed.length < 10) {
      setGoalExistingSkills([])
      setGoalDesiredSkills([])
      setGoalParsing(false)
      return
    }

    setGoalParsing(true)
    const timer = setTimeout(() => {
      goalAbortRef.current?.abort()
      const controller = new AbortController()
      goalAbortRef.current = controller

      fetch('/api/goal/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: trimmed }),
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          setGoalExistingSkills(data.existing ?? [])
          setGoalDesiredSkills(data.desired ?? [])
        })
        .catch((e) => { if (e.name !== 'AbortError') throw e })
        .finally(() => setGoalParsing(false))
    }, 800)

    return () => {
      clearTimeout(timer)
      goalAbortRef.current?.abort()
    }
  }, [goal])

  // Debounced job URL skill extraction
  useEffect(() => {
    const trimmed = jobUrl.trim()
    if (!trimmed || !trimmed.startsWith('http')) {
      setJobSkills([])
      setJobParsing(false)
      return
    }

    setJobParsing(true)
    const timer = setTimeout(() => {
      jobAbortRef.current?.abort()
      const controller = new AbortController()
      jobAbortRef.current = controller

      fetch('/api/job/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => setJobSkills(data.skills ?? []))
        .catch((e) => { if (e.name !== 'AbortError') throw e })
        .finally(() => setJobParsing(false))
    }, 800)

    return () => {
      clearTimeout(timer)
      jobAbortRef.current?.abort()
    }
  }, [jobUrl])

  function uploadFile(file: File) {
    setFileName(file.name)
    setParsing(true)
    setResumeSkills([])

    const formData = new FormData()
    formData.append('resume', file)

    fetch('/api/resume/skills', { method: 'POST', body: formData })
      .then((r) => r.json())
      .then((data) => setResumeSkills(data.skills ?? []))
      .finally(() => setParsing(false))
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) {
      setFileName(null)
      return
    }
    uploadFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }

  function removeResumeSkill(escoLabel: string) {
    setResumeSkills((prev) => prev.filter((s) => s.esco_label !== escoLabel))
  }

  function removeGoalExisting(escoLabel: string) {
    setGoalExistingSkills((prev) => prev.filter((s) => s.esco_label !== escoLabel))
  }

  function removeGoalDesired(escoLabel: string) {
    setGoalDesiredSkills((prev) => prev.filter((s) => s.esco_label !== escoLabel))
  }

  function removeJobSkill(escoLabel: string) {
    setJobSkills((prev) => prev.filter((s) => s.esco_label !== escoLabel))
  }

  function addSkill() {
    const trimmed = skillInput.trim()
    if (trimmed && !resumeSkills.some((s) => s.esco_label === trimmed)) {
      setResumeSkills((prev) => [...prev, { raw: trimmed, esco_label: trimmed, esco_uri: null }])
    }
    setSkillInput('')
  }

  function handleSkillKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addSkill()
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Existing skills = goal existing + resume skills (deduped)
    const allExisting = [...goalExistingSkills, ...resumeSkills]
    const seen = new Set<string>()
    const existingSkills = allExisting.filter((s) => {
      if (seen.has(s.esco_label)) return false
      seen.add(s.esco_label)
      return true
    })
    // Desired skills = goal desired + job skills (deduped)
    const allDesired = [...goalDesiredSkills, ...jobSkills]
    const seenDesired = new Set<string>()
    const desiredSkills = allDesired.filter((s) => {
      if (seenDesired.has(s.esco_label)) return false
      seenDesired.add(s.esco_label)
      return true
    })
    navigate('/graph', { state: { goal, existingSkills, desiredSkills, jobUrl } })
  }

  const canSubmit = goal.trim().length > 0 && !parsing && !goalParsing && !jobParsing
  const hasGoalSkills = goalExistingSkills.length > 0 || goalDesiredSkills.length > 0

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center px-4 py-16">
      {/* Hero */}
      <div className="text-center mb-12 max-w-xl">
        <h1 className="text-4xl font-bold text-stone-900 leading-tight mb-4" style={{ fontFamily: '"Manrope", sans-serif' }}>
          What do you want to learn?
        </h1>
        <p className="text-stone-500 text-lg leading-relaxed">
          Tell us your goal and we'll build a personalized skill tree with curated courses to get you there.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="w-full max-w-lg space-y-4">
        {/* Goal — primary input */}
        <div>
          <label htmlFor="goal" className="block text-sm font-semibold text-stone-800 mb-2">
            Describe your goal
          </label>
          <textarea
            id="goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="e.g. I'm a cybersecurity engineer and want to transition into full-stack development..."
            rows={4}
            className="w-full border border-stone-200 rounded-xl px-4 py-3 text-stone-900 text-base leading-relaxed outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 resize-none transition-all duration-150 placeholder:text-stone-400"
          />

          {/* Goal skills */}
          {(goalParsing || hasGoalSkills) && (
            <div className="mt-3 space-y-2.5">
              {goalParsing && !hasGoalSkills && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                  Analyzing your goal
                  <Loader2 size={10} className="animate-spin text-stone-400" />
                </span>
              )}

              {/* Skills you have */}
              {goalExistingSkills.length > 0 && (
                <div>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                    Skills you have
                    {goalParsing && <Loader2 size={10} className="animate-spin text-teal-500" />}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {goalExistingSkills.map((skill) => (
                      <span
                        key={skill.esco_label}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-teal-50 text-teal-700 transition-colors duration-150"
                      >
                        {skill.esco_label}
                        <button
                          type="button"
                          onClick={() => removeGoalExisting(skill.esco_label)}
                          className="p-0.5 -mr-1 rounded-full text-teal-400 hover:text-teal-700 hover:bg-teal-200 cursor-pointer transition-all duration-150"
                          aria-label={`Remove ${skill.esco_label}`}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Skills you want */}
              {goalDesiredSkills.length > 0 && (
                <div>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                    Skills you want
                    {goalParsing && <Loader2 size={10} className="animate-spin text-violet-500" />}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {goalDesiredSkills.map((skill) => (
                      <span
                        key={skill.esco_label}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-violet-50 text-violet-700 transition-colors duration-150"
                      >
                        {skill.esco_label}
                        <button
                          type="button"
                          onClick={() => removeGoalDesired(skill.esco_label)}
                          className="p-0.5 -mr-1 rounded-full text-violet-400 hover:text-violet-700 hover:bg-violet-200 cursor-pointer transition-all duration-150"
                          aria-label={`Remove ${skill.esco_label}`}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Optional section — secondary */}
        <div className="border border-stone-200 rounded-xl p-4 space-y-4">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-stone-400">
            Optional — helps us personalize
          </span>

          {/* Resume upload */}
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1.5">
              Resume
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`w-full flex items-center gap-3 px-4 py-3 border border-dashed rounded-xl text-sm text-stone-500 cursor-pointer transition-all duration-150 ${dragging ? 'border-teal-500 bg-teal-50' : 'border-stone-300 hover:border-stone-400 hover:bg-stone-50'}`}
            >
              {parsing ? (
                <Loader2 size={16} className="text-teal-600 shrink-0 animate-spin" />
              ) : (
                <Upload size={16} className="text-stone-400 shrink-0" />
              )}
              {parsing ? (
                <span className="text-teal-600 font-medium">Extracting skills…</span>
              ) : fileName ? (
                <span className="text-stone-900 font-medium truncate">{fileName}</span>
              ) : (
                <span>Upload PDF or DOCX</span>
              )}
            </button>

            {/* Extracted resume skills */}
            {resumeSkills.length > 0 && (
              <div className="mt-3">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-2">
                  Skills from your resume
                </span>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {resumeSkills.map((skill) => (
                    <span
                      key={skill.esco_label}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-teal-50 text-teal-700 transition-colors duration-150"
                    >
                      {skill.esco_label}
                      <button
                        type="button"
                        onClick={() => removeResumeSkill(skill.esco_label)}
                        className="p-0.5 -mr-1 rounded-full text-teal-400 hover:text-teal-700 hover:bg-teal-200 cursor-pointer transition-all duration-150"
                        aria-label={`Remove ${skill.esco_label}`}
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Add a skill..."
                    value={skillInput}
                    onChange={(e) => setSkillInput(e.target.value)}
                    onKeyDown={handleSkillKeyDown}
                    className="flex-1 border border-stone-300 rounded-lg px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 transition-all duration-150 placeholder:text-stone-400"
                  />
                  <button
                    type="button"
                    onClick={addSkill}
                    className="p-1.5 rounded-lg text-stone-400 hover:text-teal-700 hover:bg-teal-50 cursor-pointer transition-colors duration-150"
                    aria-label="Add skill"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Job posting URL */}
          <div>
            <label htmlFor="job-url" className="block text-sm font-medium text-stone-700 mb-1.5">
              Job posting link
            </label>
            <div className="flex items-center border border-stone-300 rounded-xl overflow-hidden focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/15 transition-all duration-150">
              <div className="pl-4 pr-2 text-stone-400">
                <Link size={16} />
              </div>
              <input
                id="job-url"
                type="url"
                value={jobUrl}
                onChange={(e) => setJobUrl(e.target.value)}
                placeholder="https://..."
                className="flex-1 px-2 py-3 text-sm text-stone-900 outline-none bg-transparent placeholder:text-stone-400"
              />
            </div>

            {/* Extracted job skills */}
            {(jobParsing || jobSkills.length > 0) && (
              <div className="mt-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                  Skills from job posting
                  {jobParsing && <Loader2 size={10} className="animate-spin text-amber-500" />}
                </span>
                {jobSkills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {jobSkills.map((skill) => (
                      <span
                        key={skill.esco_label}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-50 text-amber-700 transition-colors duration-150"
                      >
                        {skill.esco_label}
                        <button
                          type="button"
                          onClick={() => removeJobSkill(skill.esco_label)}
                          className="p-0.5 -mr-1 rounded-full text-amber-400 hover:text-amber-700 hover:bg-amber-200 cursor-pointer transition-all duration-150"
                          aria-label={`Remove ${skill.esco_label}`}
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-teal-700 text-white hover:bg-teal-800 shadow-sm hover:shadow-md"
        >
          {parsing || goalParsing || jobParsing ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {parsing ? 'Analyzing resume…' : jobParsing ? 'Analyzing job posting…' : 'Detecting skills…'}
            </>
          ) : (
            <>
              Build my learning path
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>

      <p className="mt-8 text-xs text-stone-400 text-center max-w-sm">
        We'll analyze your goal to identify required skills, then recommend courses for each one.
      </p>
    </div>
  )
}
