"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const BIO_STORAGE_KEY = "parcours-onboarding-bio";
const PROFILE_COMPLETE_KEY = "parcours-profile-complete";

interface OnboardingProps {
  onComplete: (profile: { goal: string; skills: string[] }) => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [bio, setBio] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async () => {
    if (!bio.trim()) {
      setError("Please enter your background and goals");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("http://127.0.0.1:5000/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to build profile");
      }

      const profile = await response.json();
      const skills = profile.current_skills.map(
        (s: { label: string }) => s.label,
      );

      localStorage.setItem(BIO_STORAGE_KEY, bio);
      localStorage.setItem(PROFILE_COMPLETE_KEY, "true");
      localStorage.setItem("parcours-goal", profile.goal);
      localStorage.setItem("parcours-known-skills", JSON.stringify(skills));

      onComplete({ goal: profile.goal, skills });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsLoading(false);
    }
  };

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
              className="min-h-48 resize-none text-base shadow-lg transition-shadow focus-visible:shadow-xl"
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
              {isLoading ? "Building your profile..." : "Build profile"}
            </Button>
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
    const complete = localStorage.getItem(PROFILE_COMPLETE_KEY) === "true";
    setIsComplete(complete);
    setIsLoaded(true);
  }, []);

  const markComplete = () => {
    localStorage.setItem(PROFILE_COMPLETE_KEY, "true");
    setIsComplete(true);
  };

  const reset = () => {
    localStorage.removeItem(PROFILE_COMPLETE_KEY);
    localStorage.removeItem(BIO_STORAGE_KEY);
    setIsComplete(false);
  };

  return { isComplete, isLoaded, markComplete, reset };
}
