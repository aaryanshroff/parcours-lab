"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { API_BASE_URL, authFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase/client";
import { FileText, Link2, Upload, X, ArrowRight } from "lucide-react";
import type { ChatResponse } from "@/lib/types";
import { setCourseHistory } from "@/lib/courses";

const LOADING_MESSAGES = [
  "Analyzing your background…",
  "Identifying your current skills…",
  "Mapping your career goals…",
  "Searching for the best courses…",
  "Personalizing your learning path…",
  "Almost there…",
];

const BIO_STORAGE_KEY = "parcours-onboarding-bio";
const GOAL_STORAGE_KEY = "parcours-goal";
const KNOWN_SKILLS_STORAGE_KEY = "parcours-known-skills";
const REQUIRED_SKILLS_STORAGE_KEY = "parcours-required-skills";
export const INITIAL_PROMPT_RESULT_KEY = "parcours-initial-prompt-result";

function toSkillLabels(
  items: Array<{ label?: string | null } | string | null | undefined>,
): string[] {
  return items
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object" && typeof item.label === "string") {
        return item.label.trim();
      }
      return "";
    })
    .filter((label) => label.length > 0);
}

interface OnboardingProps {
  onComplete: (profile: { goal: string; skills: string[] }) => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [bio, setBio] = React.useState("");
  const [resumeFile, setResumeFile] = React.useState<File | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [jobLink, setJobLink] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = React.useState(false);

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsSignedIn(!!session);
    });
  }, []);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) setResumeFile(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setResumeFile(file);
  };
  const [loadingMessageIndex, setLoadingMessageIndex] = React.useState(0);
  const [displayedText, setDisplayedText] = React.useState("");

  React.useEffect(() => {
    if (!isLoading) return;
    setLoadingMessageIndex(0);
    const interval = setInterval(() => {
      setLoadingMessageIndex((i) => Math.min(i + 1, LOADING_MESSAGES.length - 1));
    }, 1800);
    return () => clearInterval(interval);
  }, [isLoading]);

  React.useEffect(() => {
    if (!isLoading) return;
    const message = LOADING_MESSAGES[loadingMessageIndex];
    setDisplayedText("");
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayedText(message.slice(0, i));
      if (i >= message.length) clearInterval(interval);
    }, 40);
    return () => clearInterval(interval);
  }, [loadingMessageIndex, isLoading]);

  const handleSubmit = async () => {
    if (!bio.trim()) {
      setError("Please enter your background and goals");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [parsedResume, parsedJob] = await Promise.all([
        resumeFile
          ? authFetch(`${API_BASE_URL}/api/resume/parse`, {
              method: "POST",
              body: (() => { const f = new FormData(); f.append("file", resumeFile); return f; })(),
            }).then((r) => r.json())
          : Promise.resolve(null),
        jobLink.trim()
          ? authFetch(`${API_BASE_URL}/api/job/parse`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: jobLink.trim() }),
            }).then((r) => r.json())
          : Promise.resolve(null),
      ]);

      const resumeSkills: { label: string }[] | null = parsedResume?.skills ?? null;
      const jobSkills: { label: string }[] | null = parsedJob?.skills ?? null;
      const resumeLabels = new Set((resumeSkills ?? []).map((s) => s.label));
      const diffSkills = (jobSkills ?? []).filter((s) => !resumeLabels.has(s.label));

      console.log("[submit] parsedResume:", parsedResume);
      console.log("[submit] parsedJob:", parsedJob);
      console.log("[submit] resumeSkills:", resumeSkills);
      console.log("[submit] jobSkills:", jobSkills);
      console.log("[submit] diffSkills:", diffSkills);

      const body: Record<string, unknown> = { bio };
      if (resumeSkills !== null) body.current_skills = resumeSkills;
      if (jobSkills !== null) body.required_skills = diffSkills;
      console.log("[submit] body:", body);

      const response = await authFetch(`${API_BASE_URL}/api/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to build profile");
      }

      const profile = await response.json() as {
        goal?: string;
        current_skills?: Array<{ label?: string | null } | string | null>;
        required_skills?: Array<{ label?: string | null } | string | null>;
      };
      const goalValue = profile.goal ?? "";
      const currentSkills = toSkillLabels(profile.current_skills ?? []);
      const requiredSkills = toSkillLabels(profile.required_skills ?? []);

      localStorage.setItem(BIO_STORAGE_KEY, bio);
      localStorage.setItem(GOAL_STORAGE_KEY, goalValue);
      localStorage.setItem(KNOWN_SKILLS_STORAGE_KEY, JSON.stringify(currentSkills));
      localStorage.setItem(REQUIRED_SKILLS_STORAGE_KEY, JSON.stringify(requiredSkills));
      localStorage.removeItem("parcours-initial-prompt-sent");
      localStorage.removeItem("parcours-initial-prompt-goal");
      setCourseHistory([], { sync: false });
      localStorage.removeItem("parcours-messages");

      // Fire the initial chat recommendation while the loading screen is still
      // showing so chat is ready the moment the user arrives.
      const goalText = goalValue
        ? `My goal is: ${goalValue}.`
        : "Use my profile to infer a realistic learning goal.";
      const knownSkillsText = currentSkills.length
        ? `My current skills include: ${currentSkills.join(", ")}.`
        : "Assume I have beginner-to-intermediate baseline skills.";
      const initialPrompt = `${goalText} ${knownSkillsText} Create a skill roadmap with course recommendations.`;

      const courseHistory: Array<{
        title: string;
        status: "accepted" | "rejected";
        reason: string;
      }> = (() => {
        try {
          const raw = localStorage.getItem("parcours-course-history");
          if (!raw) return [];
          const parsed = JSON.parse(raw) as Array<{
            title?: string;
            status?: string;
            reason?: string;
            rejection_reason?: string;
          }>;
          if (!Array.isArray(parsed)) return [];
          return parsed
            .filter((course) => course.status === "accepted" || course.status === "rejected")
            .map((course) => ({
              title: course.title ?? "",
              status: course.status as "accepted" | "rejected",
              reason: course.reason ?? course.rejection_reason ?? "",
            }));
        } catch { return []; }
      })();

      try {
        const chatRes = await authFetch(`${API_BASE_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: [{ type: "text", text: initialPrompt }] }],
            goal: goalValue,
            required_skills: requiredSkills,
            course_history: courseHistory,
          }),
        });
        if (chatRes.ok) {
          const chatData = (await chatRes.json()) as ChatResponse;
          sessionStorage.setItem(INITIAL_PROMPT_RESULT_KEY, JSON.stringify(chatData));
        }
      } catch {
        // Best-effort — chat will fall back to its own fetch on load
      }

      onComplete({ goal: goalValue, skills: currentSkills });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-3 px-6">
        <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-[indeterminate_1.5s_ease-in-out_infinite] rounded-full bg-primary/60" />
        </div>
        <p className="text-sm text-muted-foreground">
          {displayedText}
          <span className="animate-pulse">|</span>
        </p>
        <p className="text-xs text-muted-foreground/80">This can take up to 10 seconds!</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full">
      {/* Left: form — scrolls independently if viewport is too small */}
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-8 py-8">
        <div className="w-full max-w-md space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700">

          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold shadow-md">
              P
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight leading-none">ParcoursLab</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Tell us where you're headed. We'll map the learning path.</p>
            </div>
          </div>

          {/* Card */}
          <div className="overflow-hidden rounded-2xl border bg-card shadow-xl">

            {/* Bio */}
            <div className="space-y-3 p-6">
              <label htmlFor="bio" className="flex items-center gap-1 text-sm font-semibold">
                What are you working toward?
                <span className="text-primary">*</span>
              </label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBio(e.target.value)}
                placeholder="e.g. I'm a software developer looking to move into product management…"
                className="min-h-32 resize-none border-muted bg-muted/40 text-sm leading-relaxed transition-colors focus-visible:bg-background"
                disabled={isLoading}
              />
              <div className="flex flex-wrap gap-1.5">
                {["Developer → machine learning engineer", "Software engineer pivoting to cybersecurity", "CS grad specializing in databases", "Programmer learning computer vision"].map((ex) => (
                  <button key={ex} type="button" onClick={() => setBio(ex)} disabled={isLoading}
                    className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground active:scale-95">
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 px-6">
              <div className="h-px flex-1 bg-border" />
              <span className="rounded-full border border-border bg-background px-3 py-0.5 text-[11px] font-medium text-muted-foreground">Optional — personalize your plan</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Optional */}
            <div className="space-y-3 bg-muted/20 p-6">
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 transition-all ${isDragging ? "border-primary bg-primary/5" : resumeFile ? "border-primary/30 bg-primary/5" : "border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/40"}`}
              >
                <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={handleFileSelect} />
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${resumeFile ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {resumeFile ? <FileText className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                </div>
                {resumeFile ? (
                  <div className="flex flex-1 min-w-0 items-center justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{resumeFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(resumeFile.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setResumeFile(null); }} className="ml-2 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-muted-foreground">Drop resume or <span className="text-foreground underline underline-offset-2">browse</span></p>
                    <p className="text-xs text-muted-foreground/60">PDF, DOC, DOCX</p>
                  </div>
                )}
              </div>
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                <Input id="jobLink" type="url" value={jobLink} onChange={(e) => setJobLink(e.target.value)} placeholder="Paste a job posting URL" className="pl-9" disabled={isLoading} />
              </div>
            </div>

            {error && (
              <div className="mx-6 animate-in fade-in rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive duration-200">{error}</div>
            )}

            {/* CTA */}
            <div className="space-y-2.5 p-6 pt-4">
              <Button onClick={handleSubmit} disabled={isLoading || !bio.trim()} className="group w-full gap-2 text-sm font-semibold" size="lg">
                Build my learning path
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
              {!isSignedIn && (
                <p className="text-center text-xs text-muted-foreground">
                  Already have an account?{" "}
                  <a href="/login" className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary">Sign in</a>
                </p>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Right: How it works */}
      <div className="flex flex-1 flex-col justify-center overflow-y-auto border-l bg-muted/30 px-8 py-8">
        <div className="space-y-8">

          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight">How it works</h2>
            <p className="text-sm text-muted-foreground">From your background to a personalized learning path in seconds.</p>
          </div>

          {/* Vertical timeline */}
          <div className="space-y-0">
            {[
              {
                step: "01",
                title: "Describe yourself",
                desc: "Write a short bio — your current role, skills, and where you want to go. The more specific, the better.",
              },
              {
                step: "02",
                title: "Optionally, add context",
                desc: "Upload your resume and paste a job posting URL. We'll extract your existing skills and the skills the role requires.",
              },
              {
                step: "03",
                title: "We build your skill gap",
                desc: "Your current skills are compared against the job's requirements. The difference becomes your learning roadmap.",
              },
              {
                step: "04",
                title: "Courses are matched to you",
                desc: "We search our catalog for courses that close your specific gaps — ranked by relevance.",
              },
              {
                step: "05",
                title: "Refine through chat",
                desc: "Accept, reject, or redirect recommendations. The agent learns your preferences and sharpens its picks.",
              },
            ].map(({ step, title, desc }, i, arr) => (
              <div key={step} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-[11px] font-bold tabular-nums text-muted-foreground">
                    {step}
                  </div>
                  {i < arr.length - 1 && (
                    <div className="mt-1 min-h-6 w-px flex-1 bg-border" />
                  )}
                </div>
                <div className="pb-4 pt-0.5 space-y-0.5">
                  <p className="text-sm font-semibold leading-none">{title}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ESCO callout */}
          <div className="rounded-xl border bg-card p-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Powered by ESCO</p>
            <p className="text-sm font-semibold">What is ESCO?</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              ESCO (European Skills, Competences, Qualifications and Occupations) is a multilingual taxonomy of
              ~14,000 skills maintained by the EU. We use it to map your experience and job requirements to a
              shared vocabulary — so skill matching is precise, not just keyword-based.
            </p>
          </div>


        </div>
      </div>
    </div>
  );
}

export function useOnboardingComplete() {
  const [isComplete, setIsComplete] = React.useState(false);
  const [isLoaded, setIsLoaded] = React.useState(false);

  React.useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        setIsLoaded(true);
        return;
      }

      try {
        const res = await authFetch(`${API_BASE_URL}/api/profile/me`);
        if (!res.ok) throw new Error();
        const profile = await res.json() as {
          goal?: string;
          current_skills?: Array<{ label?: string | null } | string | null>;
          required_skills?: Array<{ label?: string | null } | string | null>;
        };
        localStorage.setItem(GOAL_STORAGE_KEY, profile.goal ?? "");
        localStorage.setItem(KNOWN_SKILLS_STORAGE_KEY, JSON.stringify(toSkillLabels(profile.current_skills ?? [])));
        localStorage.setItem(REQUIRED_SKILLS_STORAGE_KEY, JSON.stringify(toSkillLabels(profile.required_skills ?? [])));
        setIsComplete(true);
      } catch {
        // No profile in DB — show onboarding
      } finally {
        setIsLoaded(true);
      }
    });
  }, []);

  const markComplete = () => {
    setIsComplete(true);
  };

  const reset = () => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("parcours-"))
      .forEach((k) => localStorage.removeItem(k));
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("parcours-"))
      .forEach((k) => sessionStorage.removeItem(k));
    setIsComplete(false);
    window.location.reload();
  };

  return { isComplete, isLoaded, markComplete, reset };
}
