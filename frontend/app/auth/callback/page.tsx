"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { API_BASE_URL, authFetch } from "@/lib/api";

const INITIAL_PROMPT_SENT_KEY = "parcours-initial-prompt-sent";
const INITIAL_PROMPT_GOAL_KEY = "parcours-initial-prompt-goal";
const INITIAL_PROMPT_RESULT_KEY = "parcours-initial-prompt-result";

function toSkillLabels(parsed: unknown): string[] {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object" && "label" in item) {
        const value = (item as { label?: unknown }).label;
        return typeof value === "string" ? value.trim() : "";
      }
      return "";
    })
    .filter((label) => label.length > 0);
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const hasPersistedRef = useRef(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const isSignedIn = (event === "SIGNED_IN" || event === "INITIAL_SESSION") && session;
        if (isSignedIn && !hasPersistedRef.current) {
          hasPersistedRef.current = true;
          subscription.unsubscribe();
          await Promise.all([persistProfile(), persistMessages()]);
          localStorage.removeItem(INITIAL_PROMPT_SENT_KEY);
          localStorage.removeItem(INITIAL_PROMPT_GOAL_KEY);
          sessionStorage.removeItem(INITIAL_PROMPT_RESULT_KEY);
          router.replace("/");
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [router]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-muted-foreground">Signing you in…</p>
    </div>
  );
}

async function persistProfile() {
  const goal = localStorage.getItem("parcours-goal");
  if (!goal) return;
  const currentSkills = toSkillLabels(JSON.parse(localStorage.getItem("parcours-known-skills") || "[]"));
  const requiredSkills = toSkillLabels(JSON.parse(localStorage.getItem("parcours-required-skills") || "[]"));
  try {
    await authFetch(`${API_BASE_URL}/api/profile/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, current_skills: currentSkills, required_skills: requiredSkills }),
    });
  } catch (e) {
    console.error("Failed to save profile:", e);
  }
}

async function persistMessages() {
  const raw = localStorage.getItem("parcours-messages");
  if (!raw) return;
  const messages = JSON.parse(raw);
  if (!messages?.length) return;
  try {
    await authFetch(`${API_BASE_URL}/api/conversations/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  } catch (e) {
    console.error("Failed to save messages:", e);
  }
}
