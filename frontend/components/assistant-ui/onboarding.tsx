"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { API_BASE_URL, authFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase/client";
import { FileText, Link2, Upload, X, ArrowRight, ChevronRight } from "lucide-react";

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

  // Bypasses the endpoint (FOR DEBUG) -------------------------------------------
  const handleDebugBypass = () => {
    const defaultSkills = [
      "JavaScript",
      "TypeScript",
      "React",
      "Python",
      "Communication",
    ];
    localStorage.setItem(BIO_STORAGE_KEY, "Debug default profile");
    localStorage.setItem(
      "parcours-goal",
      "Transition into a senior full-stack engineering role",
    );
    localStorage.setItem(
      "parcours-known-skills",
      JSON.stringify(defaultSkills),
    );
    onComplete({
      goal: "Transition into a senior full-stack engineering role",
      skills: defaultSkills,
    });
    // ----------------------------------------------------------------------------------
  };

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

      const profile = await response.json();
      const currentSkills = (profile.current_skills ?? []).map(
        (s: { label: string }) => s.label,
      );
      const requiredSkills = (profile.required_skills ?? []).map(
        (s: { label: string }) => s.label,
      );

      localStorage.setItem(BIO_STORAGE_KEY, bio);
      localStorage.setItem(GOAL_STORAGE_KEY, profile.goal);
      localStorage.setItem(KNOWN_SKILLS_STORAGE_KEY, JSON.stringify(currentSkills));
      localStorage.setItem(REQUIRED_SKILLS_STORAGE_KEY, JSON.stringify(requiredSkills));

      onComplete({ goal: profile.goal, skills: currentSkills });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-3 px-6">
        <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-[shimmer_1.5s_ease-in-out_infinite] rounded-full bg-primary/60" />
        </div>
        <p className="text-sm text-muted-foreground">
          {displayedText}
          <span className="animate-pulse">|</span>
        </p>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto">
      {/* Hero + Form */}
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-background via-background to-muted/30 px-4 py-16">
        <div className="w-full max-w-md space-y-7 animate-in fade-in slide-in-from-bottom-4 duration-700">

          {/* Brand */}
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-bold text-lg shadow-lg">
              P
            </div>
            <div className="space-y-1.5">
              <h1 className="text-3xl font-bold tracking-tight">ParcoursLab</h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Tell us where you're headed.<br />We'll map the learning path.
              </p>
            </div>
          </div>

          {/* Form card */}
          <div className="overflow-hidden rounded-2xl border bg-card shadow-xl">

            {/* Required: bio */}
            <div className="space-y-4 p-6">
              <div className="space-y-1.5">
                <label htmlFor="bio" className="flex items-center gap-1 text-sm font-semibold">
                  What are you working toward?
                  <span className="text-primary">*</span>
                </label>
                <Textarea
                  id="bio"
                  value={bio}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBio(e.target.value)}
                  placeholder="e.g. I'm a software developer looking to move into product management…"
                  className="min-h-36 resize-none border-muted bg-muted/40 text-sm leading-relaxed transition-colors focus-visible:bg-background"
                  disabled={isLoading}
                />
              </div>

              {/* Example chips */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Try an example:</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Software dev → project management",
                    "HR professional learning ML",
                    "Marketing manager → leadership",
                    "Designer learning to code",
                  ].map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => setBio(ex)}
                      disabled={isLoading}
                      className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground active:scale-95"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 px-6">
              <div className="h-px flex-1 bg-border" />
              <span className="rounded-full border border-border bg-background px-3 py-0.5 text-[11px] font-medium text-muted-foreground">
                Optional — personalize your plan
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Optional: resume + job */}
            <div className="space-y-4 bg-muted/20 p-6">

              {/* Resume upload */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Resume
                </label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 transition-all ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : resumeFile
                      ? "border-primary/30 bg-primary/5"
                      : "border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/40"
                  }`}
                >
                  <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={handleFileSelect} />
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${resumeFile ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {resumeFile ? <FileText className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                  </div>
                  {resumeFile ? (
                    <div className="flex flex-1 min-w-0 items-center justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{resumeFile.name}</p>
                        <p className="text-xs text-muted-foreground">{(resumeFile.size / 1024).toFixed(0)} KB</p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setResumeFile(null); }}
                        className="ml-2 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Drop resume or <span className="text-foreground underline underline-offset-2">browse</span>
                      </p>
                      <p className="text-xs text-muted-foreground/60">PDF, DOC, DOCX</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Job link */}
              <div className="space-y-1.5">
                <label htmlFor="jobLink" className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Target Job
                </label>
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                  <Input
                    id="jobLink"
                    type="url"
                    value={jobLink}
                    onChange={(e) => setJobLink(e.target.value)}
                    placeholder="Paste a job posting URL"
                    className="pl-9"
                    disabled={isLoading}
                  />
                </div>
                <p className="text-xs text-muted-foreground/60">
                  We'll extract required skills to highlight your gaps
                </p>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="mx-6 animate-in fade-in slide-in-from-top-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive duration-200">
                {error}
              </div>
            )}

            {/* CTA */}
            <div className="space-y-3 p-6 pt-4">
              <Button
                onClick={handleSubmit}
                disabled={isLoading || !bio.trim()}
                className="group w-full gap-2 text-sm font-semibold"
                size="lg"
              >
                Build my learning path
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <a href="/login" className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary">
                  Sign in
                </a>
              </p>
            </div>
          </div>

          {/* Debug */}
          <button
            type="button"
            onClick={handleDebugBypass}
            className="w-full text-xs text-muted-foreground/30 transition-colors hover:text-muted-foreground/60"
          >
            Generate default profile (debug)
          </button>
        </div>
      </div>

      {/* How it works */}
      <div className="border-t bg-muted/20 px-6 py-20">
        <div className="mx-auto max-w-3xl space-y-14">
          <div className="space-y-2 text-center">
            <h2 className="text-2xl font-bold tracking-tight">How it works</h2>
            <p className="text-sm text-muted-foreground">Three steps to a personalized learning path</p>
          </div>

          <div className="relative grid gap-10 md:grid-cols-3">
            <div className="absolute left-[calc(16.67%+20px)] right-[calc(16.67%+20px)] top-5 hidden h-px bg-border md:block" />
            {[
              { step: "01", title: "Share your profile", desc: "Tell us your background, current skills, and where you want to go." },
              { step: "02", title: "Get a tailored plan", desc: "We map courses to your skill gaps using the ESCO taxonomy." },
              { step: "03", title: "Refine with chat", desc: "Give feedback and the agent continuously sharpens its picks." },
            ].map(({ step, title, desc }) => (
              <div key={step} className="relative flex flex-col items-center gap-3 text-center">
                <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 border-border bg-background text-xs font-bold tabular-nums text-muted-foreground">
                  {step}
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 text-sm md:grid-cols-3">
            {[
              {
                title: "What it does",
                items: ["Recommends courses matched to your goals", "Explains why each course fits", "Learns from your feedback"],
                accent: true,
              },
              {
                title: "What it doesn't",
                items: ["Guarantee up-to-date pricing", "Replace human career advice"],
                accent: false,
              },
              {
                title: "Your data",
                items: ["Profile stored locally in your browser", "LLM used only for explanations", "Edit anytime via the sidebar"],
                accent: true,
              },
            ].map(({ title, items, accent }) => (
              <div key={title} className="rounded-xl border bg-card p-5 space-y-3">
                <h3 className="font-semibold">{title}</h3>
                <ul className="space-y-2 text-muted-foreground">
                  {items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${accent ? "text-primary" : "text-muted-foreground/50"}`} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
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
        const profile = await res.json() as { goal?: string; current_skills?: Array<{ label: string }>; required_skills?: Array<{ label: string }> };
        localStorage.setItem(GOAL_STORAGE_KEY, profile.goal ?? "");
        localStorage.setItem(KNOWN_SKILLS_STORAGE_KEY, JSON.stringify((profile.current_skills ?? []).map((s) => s.label)));
        localStorage.setItem(REQUIRED_SKILLS_STORAGE_KEY, JSON.stringify((profile.required_skills ?? []).map((s) => s.label)));
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
    setIsComplete(false);
    window.location.reload();
  };

  return { isComplete, isLoaded, markComplete, reset };
}
