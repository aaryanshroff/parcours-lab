"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { API_BASE_URL, authFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase/client";

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
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = React.useState(0);

  React.useEffect(() => {
    if (!isLoading) return;
    setLoadingMessageIndex(0);
    const interval = setInterval(() => {
      setLoadingMessageIndex((i) => Math.min(i + 1, LOADING_MESSAGES.length - 1));
    }, 1800);
    return () => clearInterval(interval);
  }, [isLoading]);

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
      const response = await authFetch(`${API_BASE_URL}/api/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio }),
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
      <div className="flex h-screen w-full flex-col items-center justify-center gap-6 px-6">
        {/* Pulsing glow circle */}
        <div className="relative flex items-center justify-center" style={{ width: 80, height: 80 }}>
          <motion.div
            className="absolute rounded-full bg-primary blur-2xl"
            style={{ width: 80, height: 80 }}
            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.85, 0.5] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <div className="h-8 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.p
              key={loadingMessageIndex}
              className="text-center text-lg text-muted-foreground"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35, ease: "easeInOut" }}
            >
              {LOADING_MESSAGES[loadingMessageIndex]}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="flex min-h-screen w-full flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
          <div className="space-y-3 text-center">
            <h1 className="font-bold text-5xl tracking-tight md:text-6xl">
              ParcoursLab
            </h1>
            <p className="text-muted-foreground text-xl">
              Coachable course recommender
            </p>
          </div>

          <div className="space-y-4">
            <Textarea
              id="bio"
              value={bio}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setBio(e.target.value)
              }
              placeholder="Tell us about your background, skills, and goals..."
              className="min-h-32 resize-none p-4 text-sm shadow-lg transition-shadow focus-visible:shadow-xl md:min-h-48 md:text-base"
              disabled={isLoading}
            />

            <div className="space-y-2 text-muted-foreground text-sm">
              <p className="font-medium">Examples:</p>
              <ul className="ml-4 space-y-1.5">
                <li>
                  • Software developer wanting to move into project management
                </li>
                <li>
                  • HR professional looking to pick up machine learning basics
                </li>
                <li>
                  • Marketing manager aiming to strengthen leadership skills
                </li>
              </ul>
            </div>

            {error && (
              <div className="animate-in fade-in slide-in-from-top-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-destructive text-sm duration-300">
                {error}
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={isLoading || !bio.trim()}
              className="w-full text-base shadow-lg transition-all hover:shadow-xl"
              size="lg"
            >
              Build profile
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <a href="/login" className="underline underline-offset-4 hover:text-foreground transition-colors">
                Sign in
              </a>
            </p>
            <button
              type="button"
              onClick={handleDebugBypass}
              className="w-full text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              Generate default profile (debug)
            </button>
          </div>
        </div>
      </div>

      <div className="w-full border-t bg-muted/30 px-6 py-10">
        <div className="mx-auto max-w-3xl space-y-12">
          <h2 className="text-center font-bold text-3xl">How it works</h2>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-xl">
                1
              </div>
              <h3 className="font-semibold text-lg">Share your profile</h3>
              <p className="text-muted-foreground text-sm">
                Tell us your background, skills, and career goals
              </p>
            </div>

            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-xl">
                2
              </div>
              <h3 className="font-semibold text-lg">Get recommendations</h3>
              <p className="text-muted-foreground text-sm">
                Receive curated courses matched to your profile using ESCO
                taxonomy
              </p>
            </div>

            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-xl">
                3
              </div>
              <h3 className="font-semibold text-lg">Refine through chat</h3>
              <p className="text-muted-foreground text-sm">
                Give feedback and the agent learns to improve suggestions
              </p>
            </div>
          </div>

          <div className="space-y-6 rounded-lg border bg-card p-8 shadow-sm">
            <div className="space-y-3">
              <h3 className="font-semibold text-lg">What it does</h3>
              <ul className="ml-4 space-y-2 text-muted-foreground text-sm">
                <li>• Recommends courses based on your skills and goals</li>
                <li>• Explains why each course fits your profile</li>
                <li>• Learns from your feedback to improve suggestions</li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-lg">What it doesn't do</h3>
              <ul className="ml-4 space-y-2 text-muted-foreground text-sm">
                <li>• Guarantee up-to-date pricing or certification info</li>
                <li>• Replace human career advice</li>
              </ul>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-lg">Your data</h3>
              <ul className="ml-4 space-y-2 text-muted-foreground text-sm">
                <li>• Profile stored locally in your browser</li>
                <li>• LLM used only for generating explanations</li>
                <li>• Edit anytime via sidebar sections</li>
              </ul>
            </div>
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
