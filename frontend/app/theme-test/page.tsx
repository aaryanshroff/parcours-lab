"use client";

import { useState } from "react";

const THEMES = {
  current: {
    name: "Current (Teal / Rose)",
    accept: "#0e8b8b",
    acceptHover: "#0b7272",
    reject: "#b04058",
    rejectHover: "#943648",
    pill: "#f5f3ed",
    pillText: "#8a7e72",
    pillBorder: "transparent",
  },
  terracotta: {
    name: "A — Terracotta / Sage",
    accept: "#7a8c6e",
    acceptHover: "#67795d",
    reject: "#c0704a",
    rejectHover: "#a55f3e",
    pill: "#eae7df",
    pillText: "#6b5e50",
    pillBorder: "#d9d4c9",
  },
  navy: {
    name: "B — Navy / Amber",
    accept: "#4a6274",
    acceptHover: "#3b5060",
    reject: "#c4883a",
    rejectHover: "#a87430",
    pill: "#e8e4db",
    pillText: "#5c5347",
    pillBorder: "#d4cfc4",
  },
  olive: {
    name: "C — Olive / Burgundy",
    accept: "#6b7c5a",
    acceptHover: "#5a6a4c",
    reject: "#8b4a5e",
    rejectHover: "#743e4f",
    pill: "#ece9e0",
    pillText: "#6e6355",
    pillBorder: "#dbd6cb",
  },
  monochrome: {
    name: "D — Warm Mono (Brown only)",
    accept: "#6b5e50",
    acceptHover: "#5a4e42",
    reject: "#a08272",
    rejectHover: "#8a6f60",
    pill: "#edeae3",
    pillText: "#7a6e62",
    pillBorder: "#d9d4c9",
  },
} as const;

type ThemeKey = keyof typeof THEMES;

const SAMPLE_SKILLS = ["Python", "TensorFlow", "Data Analysis", "Machine Learning", "Statistics"];
const SAMPLE_REASONS = ["Too advanced", "Already taken", "Not relevant", "Wrong language"];

function CourseCardPreview({ theme }: { theme: (typeof THEMES)[ThemeKey] }) {
  const [showReject, setShowReject] = useState(false);
  const [selectedReason, setSelectedReason] = useState("");

  return (
    <div className="flex flex-col rounded-xl border border-border bg-background/80 p-4 shadow-sm">
      <div className="mb-2">
        <span className="inline font-semibold text-sm leading-snug">
          <a href="#" className="underline-offset-2 hover:underline">
            Introduction to Machine Learning
          </a>
          <span className="ml-1.5 inline-flex size-4 -translate-y-px cursor-help items-center justify-center rounded-full border border-border text-[10px] font-normal text-muted-foreground">
            ?
          </span>
        </span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">Coursera · Beginner · Online</p>
      <p className="mb-2 text-xs text-muted-foreground/80">40 hrs · Free · ★ 4.7 · Certificate included</p>
      <p className="mb-3 text-muted-foreground text-sm leading-relaxed">
        A beginner-friendly course covering ML fundamentals, supervised and unsupervised learning.
      </p>

      <div className="mb-3 flex flex-wrap gap-1">
        {SAMPLE_SKILLS.map((skill) => (
          <span
            key={skill}
            className="rounded px-1.5 py-0.5 text-[11px]"
            style={{
              backgroundColor: theme.pill,
              color: theme.pillText,
              border: theme.pillBorder !== "transparent" ? `1px solid ${theme.pillBorder}` : undefined,
            }}
          >
            {skill}
          </span>
        ))}
      </div>

      <div className="mt-auto" />

      {showReject ? (
        <div className="mt-1 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Why not this course?</p>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_REASONS.map((reason) => (
              <button
                key={reason}
                onClick={() => setSelectedReason((prev) => (prev === reason ? "" : reason))}
                className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  selectedReason === reason
                    ? "border-foreground/30 bg-foreground/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Other reason (optional)"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex items-center gap-2">
            <button
              className="rounded-md px-3 py-1.5 font-medium text-white text-xs transition-colors"
              style={{ backgroundColor: theme.reject }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.rejectHover)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = theme.reject)}
            >
              Submit
            </button>
            <button
              onClick={() => setShowReject(false)}
              className="rounded-md border border-border px-3 py-1.5 font-medium text-xs text-muted-foreground transition-colors hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <button
            className="rounded-md px-3 py-1.5 font-medium text-white text-xs transition-colors"
            style={{ backgroundColor: theme.accept }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.acceptHover)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = theme.accept)}
          >
            Accept
          </button>
          <button
            onClick={() => setShowReject(true)}
            className="rounded-md px-3 py-1.5 font-medium text-white text-xs transition-colors"
            style={{ backgroundColor: theme.reject }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.rejectHover)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = theme.reject)}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

function SkillsPillsPreview({ theme }: { theme: (typeof THEMES)[ThemeKey] }) {
  const allSkills = [
    "JavaScript", "TypeScript", "React", "Python", "Node.js",
    "SQL", "Docker", "AWS", "Communication", "Leadership",
  ];
  return (
    <div>
      <p className="mb-2 font-semibold text-sm">Skills</p>
      <div className="flex flex-wrap gap-1.5">
        {allSkills.map((skill) => (
          <span
            key={skill}
            className="rounded-md px-2 py-1 text-xs"
            style={{
              backgroundColor: theme.pill,
              color: theme.pillText,
              border: theme.pillBorder !== "transparent" ? `1px solid ${theme.pillBorder}` : undefined,
            }}
          >
            {skill}
          </span>
        ))}
      </div>
    </div>
  );
}

function GoalPreview({ theme }: { theme: (typeof THEMES)[ThemeKey] }) {
  return (
    <div>
      <p className="mb-2 font-semibold text-sm">Goal</p>
      <div
        className="rounded-md px-3 py-2"
        style={{
          backgroundColor: theme.pill,
          border: theme.pillBorder !== "transparent" ? `1px solid ${theme.pillBorder}` : undefined,
        }}
      >
        <p className="text-xs font-semibold" style={{ color: theme.pillText }}>
          Transition into a senior full-stack engineering role
        </p>
      </div>
    </div>
  );
}

function CourseHistoryPreview({ theme }: { theme: (typeof THEMES)[ThemeKey] }) {
  const courses = [
    { title: "React Advanced Patterns", status: "accepted" as const },
    { title: "AWS Cloud Practitioner", status: "rejected" as const },
    { title: "System Design Interview", status: "accepted" as const },
  ];
  return (
    <div>
      <p className="mb-2 font-semibold text-sm">Course History</p>
      <div className="space-y-1.5">
        {courses.map((c) => (
          <div key={c.title} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-xs">{c.title}</span>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
              style={{
                backgroundColor: c.status === "accepted" ? theme.accept : theme.reject,
              }}
            >
              {c.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ButtonsPreview({ theme }: { theme: (typeof THEMES)[ThemeKey] }) {
  return (
    <div>
      <p className="mb-2 font-semibold text-sm">Buttons</p>
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md px-4 py-2 font-medium text-white text-sm transition-colors"
          style={{ backgroundColor: theme.accept }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.acceptHover)}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = theme.accept)}
        >
          Primary Action
        </button>
        <button
          className="rounded-md px-4 py-2 font-medium text-white text-sm transition-colors"
          style={{ backgroundColor: theme.reject }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.rejectHover)}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = theme.reject)}
        >
          Secondary Action
        </button>
        <button className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted">
          Outline
        </button>
      </div>
    </div>
  );
}

export default function ThemeTestPage() {
  const [activeTheme, setActiveTheme] = useState<ThemeKey>("current");
  const theme = THEMES[activeTheme];

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <h1 className="text-4xl font-bold">Theme Test</h1>
          <p className="mt-1 text-muted-foreground">Compare accent color palettes for our warm cream/brown theme.</p>
        </div>

        {/* Theme switcher */}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(THEMES) as ThemeKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setActiveTheme(key)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                activeTheme === key
                  ? "border-foreground/30 bg-foreground/10 font-medium"
                  : "border-border hover:bg-muted"
              }`}
            >
              <span className="flex gap-1">
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: THEMES[key].accept }}
                />
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: THEMES[key].reject }}
                />
              </span>
              {THEMES[key].name}
            </button>
          ))}
        </div>

        {/* Active palette swatch */}
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3">
          <span className="text-xs text-muted-foreground">Palette:</span>
          {[theme.accept, theme.reject, theme.pill, theme.pillText, theme.pillBorder].map((c, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <span
                className="size-6 rounded border border-border"
                style={{ backgroundColor: c }}
              />
              <span className="text-[9px] text-muted-foreground font-mono">{c}</span>
            </div>
          ))}
        </div>

        {/* Components */}
        <div className="space-y-8">
          <div>
            <h2 className="mb-3 font-semibold text-lg">Course Card</h2>
            <div className="max-w-md">
              <CourseCardPreview theme={theme} />
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-semibold text-lg">Course History</h2>
            <div className="max-w-md">
              <CourseHistoryPreview theme={theme} />
            </div>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <h2 className="mb-3 font-semibold text-lg">Skills Pills</h2>
              <SkillsPillsPreview theme={theme} />
            </div>
            <div>
              <h2 className="mb-3 font-semibold text-lg">Goal Section</h2>
              <GoalPreview theme={theme} />
            </div>
          </div>

          <div>
            <h2 className="mb-3 font-semibold text-lg">Buttons</h2>
            <ButtonsPreview theme={theme} />
          </div>
        </div>
      </div>
    </div>
  );
}
