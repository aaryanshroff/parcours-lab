"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FC,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ExternalLinkIcon,
  ChevronDownIcon,
  CheckIcon,
  XIcon,
  SparklesIcon,
  BookOpenIcon,
  LoaderIcon,
} from "lucide-react";
import type { SkillRoadmap, SkillNode, RecommendedCourse } from "@/lib/types";
import { addCourse, isCourseRecorded } from "@/lib/courses";
import { API_BASE_URL, authFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

/* ── Constants ───────────────────────────────────────────────────────── */

const REJECT_REASONS = ["Too advanced", "Already taken", "Not relevant"];

const LEVEL_STYLE: Record<
  string,
  { text: string; border: string; badge: string; port: string }
> = {
  beginner: {
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-l-emerald-500/50",
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    port: "bg-emerald-500/50",
  },
  intermediate: {
    text: "text-amber-600 dark:text-amber-400",
    border: "border-l-amber-500/50",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    port: "bg-amber-500/50",
  },
  advanced: {
    text: "text-rose-600 dark:text-rose-400",
    border: "border-l-rose-500/50",
    badge: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    port: "bg-rose-500/50",
  },
};

const DEFAULT_LEVEL = {
  text: "text-muted-foreground",
  border: "border-l-border",
  badge: "bg-muted text-muted-foreground",
  port: "bg-muted-foreground/40",
};

/* ── Utilities ───────────────────────────────────────────────────────── */

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getRequiredSkillsSet(): Set<string> {
  try {
    const raw = localStorage.getItem("parcours-required-skills");
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Array<
      string | { label?: string | null } | null
    >;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .map((item) => {
          if (typeof item === "string") return item.trim().toLowerCase();
          if (item && typeof item === "object" && typeof item.label === "string")
            return item.label.trim().toLowerCase();
          return "";
        })
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

/* ── Tree layout: group skills by depth level ────────────────────────── */

function computeLevels(skills: SkillNode[]): SkillNode[][] {
  const idSet = new Set(skills.map((s) => s.id));
  const idMap = new Map(skills.map((s) => [s.id, s]));
  const depths = new Map<string, number>();
  const computing = new Set<string>();

  function getDepth(id: string): number {
    if (depths.has(id)) return depths.get(id)!;
    if (computing.has(id)) return 0; // cycle guard
    computing.add(id);
    const skill = idMap.get(id);
    if (!skill || skill.depends_on.length === 0) {
      depths.set(id, 0);
      computing.delete(id);
      return 0;
    }
    const validDeps = skill.depends_on.filter((d) => idSet.has(d));
    if (validDeps.length === 0) {
      depths.set(id, 0);
      computing.delete(id);
      return 0;
    }
    const maxParent = Math.max(...validDeps.map(getDepth));
    const d = maxParent + 1;
    depths.set(id, d);
    computing.delete(id);
    return d;
  }

  for (const s of skills) getDepth(s.id);

  const levels: SkillNode[][] = [];
  for (const s of skills) {
    const d = depths.get(s.id) ?? 0;
    while (levels.length <= d) levels.push([]);
    levels[d].push(s);
  }
  return levels;
}

/* ── SVG helpers ─────────────────────────────────────────────────────── */

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dy = Math.abs(y2 - y1);
  const cp = dy * 0.45;
  return `M ${x1} ${y1} C ${x1} ${y1 + cp}, ${x2} ${y2 - cp}, ${x2} ${y2}`;
}

/* ── Edge measurement hook ───────────────────────────────────────────── */

type Edge = { from: string; to: string; path: string };

function useGraphEdges(
  containerRef: React.RefObject<HTMLDivElement | null>,
  nodeRefs: React.RefObject<Record<string, HTMLDivElement | null>>,
  skills: SkillNode[],
  expandedId: string | null,
) {
  const [edges, setEdges] = useState<Edge[]>([]);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const refs = nodeRefs.current;
    if (!container || !refs) return;
    const cRect = container.getBoundingClientRect();
    const result: Edge[] = [];
    const idSet = new Set(skills.map((s) => s.id));

    for (const skill of skills) {
      for (const depId of skill.depends_on) {
        if (!idSet.has(depId)) continue;
        const fromEl = refs[depId];
        const toEl = refs[skill.id];
        if (!fromEl || !toEl) continue;
        const fR = fromEl.getBoundingClientRect();
        const tR = toEl.getBoundingClientRect();
        result.push({
          from: depId,
          to: skill.id,
          path: bezierPath(
            fR.left + fR.width / 2 - cRect.left,
            fR.bottom - cRect.top + 5,
            tR.left + tR.width / 2 - cRect.left,
            tR.top - cRect.top - 5,
          ),
        });
      }
    }
    setEdges(result);
  }, [containerRef, nodeRefs, skills]);

  useEffect(() => {
    requestAnimationFrame(measure);
  }, [measure]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      measure();
      setTimeout(measure, 350);
    });
    return () => cancelAnimationFrame(raf);
  }, [expandedId, measure]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => requestAnimationFrame(measure));
    obs.observe(el);
    return () => obs.disconnect();
  }, [containerRef, measure]);

  return edges;
}

/* ── Course section inside a skill node ──────────────────────────────── */

type ActionState = "idle" | "picking_reason" | "replacing";

const ReasonPicker: FC<{
  onReject: (reason: string) => void;
  onCancel: () => void;
}> = ({ onReject, onCancel }) => {
  const [custom, setCustom] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-muted-foreground">Why replace?</p>
      <div className="flex flex-wrap gap-1.5">
        {REJECT_REASONS.map((reason) => (
          <button
            key={reason}
            type="button"
            onClick={() => onReject(reason)}
            className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-[var(--course-reject)]/40 hover:bg-[var(--course-reject)]/5 hover:text-[var(--course-reject)]"
          >
            {reason}
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          onReject(custom.trim());
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Other reason…"
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-0.5 text-[10px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          Go
        </button>
      </form>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onReject("")}
          className="text-[10px] font-medium text-muted-foreground/70 underline-offset-2 hover:underline hover:text-foreground transition-colors"
        >
          Skip reason & replace
        </button>
        <span className="text-[10px] text-border">·</span>
        <button
          type="button"
          onClick={onCancel}
          className="text-[10px] text-muted-foreground/50 underline-offset-2 hover:underline hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

const CourseSection: FC<{
  course: RecommendedCourse;
  skill: SkillNode;
  courseKey: number;
  onAccept: () => void;
  onReject: (reason: string) => void;
  actionState: ActionState;
  onStartReject: () => void;
  onCancelReject: () => void;
}> = ({
  course,
  skill,
  onAccept,
  onReject,
  actionState,
  onStartReject,
  onCancelReject,
}) => {
  const title = course.title || "Untitled course";
  const recorded = isCourseRecorded(title);
  const requiredSkills = getRequiredSkillsSet();

  const matchingSkills = (course.skills ?? []).filter((s) =>
    requiredSkills.has(s.name.toLowerCase()),
  );
  const otherSkills = (course.skills ?? []).filter(
    (s) => !requiredSkills.has(s.name.toLowerCase()),
  );

  const meta: string[] = [];
  if (course.provider) meta.push(course.provider);
  if (course.level && course.level !== "unknown") meta.push(capitalize(course.level));
  if (course.format) meta.push(capitalize(course.format));
  if (course.duration_hours && course.duration_hours > 0)
    meta.push(`${course.duration_hours} hrs`);
  if (course.rating != null) meta.push(`★ ${course.rating.toFixed(1)}`);

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold leading-snug">
            {course.url ? (
              <a
                href={course.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline"
              >
                {title}
              </a>
            ) : (
              title
            )}
          </p>
          {meta.length > 0 && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {meta.join(" · ")}
            </p>
          )}
        </div>
        {course.url && (
          <a
            href={course.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 shrink-0 text-muted-foreground/40 hover:text-primary transition-colors"
          >
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </div>

      {course.summary && (
        <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
          {course.summary}
        </p>
      )}

      {(matchingSkills.length > 0 || otherSkills.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {matchingSkills.map((s, i) => (
            <span
              key={`m-${i}`}
              className="rounded border border-primary/30 bg-primary/10 px-1.5 py-px text-[9px] font-medium text-primary"
            >
              {s.name}
            </span>
          ))}
          {otherSkills.slice(0, 3).map((s, i) => (
            <span
              key={`o-${i}`}
              className="rounded bg-muted/60 px-1.5 py-px text-[9px] text-muted-foreground"
            >
              {s.name}
            </span>
          ))}
          {otherSkills.length > 3 && (
            <span className="text-[9px] text-muted-foreground/40">
              +{otherSkills.length - 3}
            </span>
          )}
        </div>
      )}

      {/* ── Actions ─────────────────────────────────────────────── */}
      {recorded ? (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--course-accept)]">
          <CheckIcon className="size-2.5" />
          Accepted
        </span>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {actionState === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 pt-0.5"
            >
              <button
                type="button"
                onClick={onAccept}
                className="rounded-md px-2.5 py-1 font-medium text-white text-[11px] transition-colors"
                style={{ backgroundColor: "var(--course-accept)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--course-accept-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "var(--course-accept)")
                }
              >
                Accept
              </button>
              <button
                type="button"
                onClick={onStartReject}
                className="rounded-md border border-border px-2.5 py-1 font-medium text-[11px] text-muted-foreground transition-colors hover:bg-muted"
              >
                Replace
              </button>
            </motion.div>
          )}

          {actionState === "picking_reason" && (
            <motion.div
              key="picking"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="pt-0.5"
            >
              <ReasonPicker onReject={onReject} onCancel={onCancelReject} />
            </motion.div>
          )}

          {actionState === "replacing" && (
            <motion.div
              key="replacing"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 py-2"
            >
              <LoaderIcon className="size-3 animate-spin text-primary/50" />
              <span className="text-[11px] text-muted-foreground">
                Finding alternative…
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};

/* ── Skill graph node ────────────────────────────────────────────────── */

const SkillGraphNode: FC<{
  skill: SkillNode;
  index: number;
  hasIncoming: boolean;
  hasOutgoing: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onRef: (el: HTMLDivElement | null) => void;
}> = ({ skill, index, hasIncoming, hasOutgoing, isExpanded, onToggle, onRef }) => {
  const levelKey = (skill.level ?? "").toLowerCase();
  const lvl = LEVEL_STYLE[levelKey] ?? DEFAULT_LEVEL;

  const [currentCourse, setCurrentCourse] = useState<RecommendedCourse | null>(
    skill.course,
  );
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [rejectedIds, setRejectedIds] = useState<string[]>([]);
  const [courseKey, setCourseKey] = useState(0);

  const handleAccept = () => {
    if (!currentCourse) return;
    addCourse({
      id: currentCourse.id,
      title: currentCourse.title || "Untitled",
      status: "accepted",
      provider: currentCourse.provider,
      url: currentCourse.url,
      summary: currentCourse.summary,
      level: currentCourse.level,
      format: currentCourse.format,
      duration_hours: currentCourse.duration_hours,
      price: currentCourse.price,
      rating: currentCourse.rating,
      certificate: currentCourse.certificate,
      skills: currentCourse.skills,
    });
    setCourseKey((k) => k + 1);
  };

  const handleReject = async (reason: string) => {
    if (!currentCourse) return;
    const oldId = currentCourse.id ?? "";

    addCourse({
      id: oldId,
      title: currentCourse.title || "Untitled",
      status: "rejected",
      rejection_reason: reason || undefined,
      provider: currentCourse.provider,
      url: currentCourse.url,
      summary: currentCourse.summary,
      level: currentCourse.level,
      format: currentCourse.format,
      duration_hours: currentCourse.duration_hours,
      price: currentCourse.price,
      rating: currentCourse.rating,
      certificate: currentCourse.certificate,
      skills: currentCourse.skills,
    });

    const newRejected = [...rejectedIds, oldId].filter(Boolean);
    setRejectedIds(newRejected);
    setActionState("replacing");

    try {
      const goal = localStorage.getItem("parcours-goal") ?? "";
      const res = await authFetch(`${API_BASE_URL}/api/replace_course`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skill_name: skill.name,
          skill_description: skill.description,
          goal,
          exclude_course_ids: newRejected,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { course: RecommendedCourse };
        setCurrentCourse(data.course);
      } else {
        setCurrentCourse(null);
      }
    } catch {
      setCurrentCourse(null);
    } finally {
      setActionState("idle");
      setCourseKey((k) => k + 1);
    }
  };

  return (
    <motion.div
      ref={onRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: "easeOut" }}
      className="relative flex-1 max-w-[18rem]"
    >
      {/* Top port */}
      {hasIncoming && (
        <div
          className={cn(
            "absolute -top-[5px] left-1/2 z-20 size-[9px] -translate-x-1/2 rounded-full border-2 border-background",
            lvl.port,
          )}
        />
      )}

      {/* Card */}
      <div
        className={cn(
          "relative z-10 cursor-pointer rounded-xl border border-border border-l-[3px] bg-background transition-all duration-200",
          lvl.border,
          isExpanded
            ? "shadow-lg shadow-primary/[0.06] ring-1 ring-primary/15"
            : "hover:shadow-md hover:shadow-primary/[0.03] hover:ring-1 hover:ring-primary/10",
        )}
      >
        {/* Compact header */}
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-start gap-2 p-2.5 text-left"
        >
          <span
            className={cn(
              "mt-px flex size-[18px] shrink-0 items-center justify-center rounded text-[9px] font-bold tabular-nums",
              lvl.badge,
            )}
          >
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-1.5">
              <h4 className="text-[12px] font-semibold leading-snug">
                {skill.name}
              </h4>
              <ChevronDownIcon
                className={cn(
                  "mt-px size-3 shrink-0 text-muted-foreground/40 transition-transform duration-200",
                  isExpanded && "rotate-180",
                )}
              />
            </div>
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground line-clamp-1">
              {skill.description}
            </p>
            {!isExpanded && currentCourse && (
              <p className="mt-1 truncate text-[9px] text-muted-foreground/50">
                📘 {currentCourse.title}
              </p>
            )}
          </div>
        </button>

        {/* Expanded panel */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="detail"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
              className="overflow-hidden"
            >
              <div className="border-t border-border/40 px-2.5 pb-2.5 pt-2 space-y-2.5">
                {/* Why this skill */}
                <div className="flex gap-1.5 rounded-lg bg-primary/[0.04] p-2">
                  <SparklesIcon className="mt-0.5 size-3 shrink-0 text-primary/60" />
                  <p className="text-[10px] leading-relaxed text-foreground/70">
                    {skill.why}
                  </p>
                </div>

                {/* Course card */}
                <div className="rounded-lg border border-border/50 bg-muted/20 p-2">
                  <p className="mb-1.5 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/40">
                    Recommended Course
                  </p>

                  <AnimatePresence mode="wait">
                    {actionState === "replacing" ? (
                      <motion.div
                        key="loading"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="flex items-center gap-2 py-3"
                      >
                        <LoaderIcon className="size-3 animate-spin text-primary/50" />
                        <span className="text-[10px] text-muted-foreground">
                          Finding alternative for{" "}
                          <span className="font-medium text-foreground/70">
                            {skill.name}
                          </span>
                          …
                        </span>
                      </motion.div>
                    ) : currentCourse ? (
                      <motion.div
                        key={`course-${courseKey}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.2 }}
                      >
                        <CourseSection
                          course={currentCourse}
                          skill={skill}
                          courseKey={courseKey}
                          onAccept={handleAccept}
                          onReject={handleReject}
                          actionState={actionState}
                          onStartReject={() => setActionState("picking_reason")}
                          onCancelReject={() => setActionState("idle")}
                        />
                      </motion.div>
                    ) : (
                      <motion.p
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="py-2 text-[10px] text-muted-foreground/60"
                      >
                        No courses available for this skill.
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom port */}
      {hasOutgoing && (
        <div
          className={cn(
            "absolute -bottom-[5px] left-1/2 z-20 size-[9px] -translate-x-1/2 rounded-full border-2 border-background",
            lvl.port,
          )}
        />
      )}
    </motion.div>
  );
};

/* ── Main roadmap ────────────────────────────────────────────────────── */

export const CourseRoadmap: FC<{ roadmap: SkillRoadmap }> = ({ roadmap }) => {
  const levels = computeLevels(roadmap.skills);
  const idSet = new Set(roadmap.skills.map((s) => s.id));
  const hasIncoming = new Set(
    roadmap.skills.filter((s) => s.depends_on.some((d) => idSet.has(d))).map((s) => s.id),
  );
  const hasOutgoing = new Set(
    roadmap.skills.flatMap((s) => s.depends_on.filter((d) => idSet.has(d))),
  );

  // Assign global index (top-to-bottom, left-to-right within each level)
  const nodeIndex = new Map<string, number>();
  let idx = 0;
  for (const row of levels) {
    for (const skill of row) {
      nodeIndex.set(skill.id, idx++);
    }
  }

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [svgFilterId] = useState(
    () => `glow-${Math.random().toString(36).slice(2, 7)}`,
  );

  const edges = useGraphEdges(
    containerRef,
    nodeRefs,
    roadmap.skills,
    expandedId,
  );

  return (
    <div className="mt-5 mb-1">
      {/* Header */}
      <div className="mb-3 flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <BookOpenIcon className="size-3.5 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Skill Roadmap
          </span>
        </div>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
        <span className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[10px] font-medium text-primary">
          {roadmap.skills.length} skill
          {roadmap.skills.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Graph canvas */}
      <div
        ref={containerRef}
        className="relative rounded-2xl border border-border/60 bg-background/60 px-4 pt-5 pb-4"
        style={{
          backgroundImage:
            "radial-gradient(circle, oklch(0.5 0.01 286 / 0.06) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        {/* SVG edge layer */}
        <svg
          className="pointer-events-none absolute inset-0 z-0"
          style={{ width: "100%", height: "100%", overflow: "visible" }}
        >
          <defs>
            <filter
              id={svgFilterId}
              x="-30%"
              y="-30%"
              width="160%"
              height="160%"
            >
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feFlood
                floodColor="oklch(0.55 0.15 260)"
                floodOpacity="0.15"
                result="color"
              />
              <feComposite in="color" in2="blur" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {edges.map((edge, i) => (
            <g key={`${edge.from}-${edge.to}`}>
              {/* Glow */}
              <motion.path
                d={edge.path}
                fill="none"
                stroke="oklch(0.55 0.15 260)"
                strokeWidth="3"
                strokeLinecap="round"
                filter={`url(#${svgFilterId})`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.12 }}
                transition={{ delay: i * 0.08 + 0.3, duration: 0.5 }}
              />
              {/* Dashed edge */}
              <motion.path
                d={edge.path}
                fill="none"
                stroke="currentColor"
                className="text-primary/25 animate-graph-flow"
                strokeWidth="1.5"
                strokeDasharray="8 6"
                strokeLinecap="round"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.08 + 0.3, duration: 0.5 }}
              />
            </g>
          ))}
        </svg>

        {/* Level rows */}
        <div className="relative z-10 flex flex-col gap-y-14">
          {levels.map((row, levelIdx) => (
            <div
              key={levelIdx}
              className="flex items-start justify-center gap-3"
            >
              {row.map((skill) => (
                <SkillGraphNode
                  key={skill.id}
                  skill={skill}
                  index={nodeIndex.get(skill.id) ?? 0}
                  hasIncoming={hasIncoming.has(skill.id)}
                  hasOutgoing={hasOutgoing.has(skill.id)}
                  isExpanded={expandedId === skill.id}
                  onToggle={() =>
                    setExpandedId(
                      expandedId === skill.id ? null : skill.id,
                    )
                  }
                  onRef={(el) => {
                    nodeRefs.current[skill.id] = el;
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
