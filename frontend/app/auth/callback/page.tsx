"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { API_BASE_URL, authFetch } from "@/lib/api";

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
  const currentSkills = JSON.parse(localStorage.getItem("parcours-known-skills") || "[]");
  const requiredSkills = JSON.parse(localStorage.getItem("parcours-required-skills") || "[]");
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
