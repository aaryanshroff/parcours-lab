"use client";

import * as React from "react";
import { PencilIcon } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SidebarSection } from "@/components/ui/sidebar";
import { MobileDialogContent } from "@/components/ui/mobile-dialog";
import { API_BASE_URL, authFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase/client";

const GOAL_STORAGE_KEY = "parcours-goal";
const MAX_DISPLAY_LENGTH = 80;

function loadGoal(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(GOAL_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveGoalLocally(goal: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GOAL_STORAGE_KEY, goal);
  } catch {
    // ignore
  }
}

function GoalDisplay({ goal }: { goal: string }) {
  const displayText =
    goal.length > MAX_DISPLAY_LENGTH
      ? `${goal.slice(0, MAX_DISPLAY_LENGTH)}...`
      : goal;

  return (
    <div className="rounded-md border bg-sidebar-accent/50 px-3 py-2">
      <p className="text-sidebar-foreground text-xs font-semibold">
        {displayText || "Set your goal"}
      </p>
    </div>
  );
}

function GoalsModal({
  open,
  onOpenChange,
  goal,
  onGoalChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: string;
  onGoalChange: (goal: string) => void;
}) {
  const [value, setValue] = React.useState(goal);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) {
      setValue(goal);
      const t = setTimeout(() => textareaRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open, goal]);

  const handleSave = () => {
    onGoalChange(value);
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <MobileDialogContent title="Edit Goal">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter your goal..."
          className="min-h-32 resize-none"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </MobileDialogContent>
    </Dialog>
  );
}

export function GoalsSection() {
  const [goal, setGoal] = React.useState("");
  const [modalOpen, setModalOpen] = React.useState(false);
  const [isHydrated, setIsHydrated] = React.useState(false);

  // Load: prefer backend if authenticated, fall back to localStorage
  React.useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        try {
          const res = await authFetch(`${API_BASE_URL}/api/profile/me`);
          if (res.ok) {
            const data = await res.json();
            setGoal(data.goal || "");
            setIsHydrated(true);
            return;
          }
        } catch {
          // fall through to localStorage
        }
      }
      setGoal(loadGoal());
      setIsHydrated(true);
    });
  }, []);

  // Save: always persist locally, and to backend if authenticated
  const handleGoalChange = React.useCallback(async (newGoal: string) => {
    setGoal(newGoal);
    saveGoalLocally(newGoal);
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      authFetch(`${API_BASE_URL}/api/profile/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: newGoal }),
      }).catch(() => {});
    }
  }, []);

  return (
    <>
      <SidebarSection
        title="Goal"
        action={
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-sidebar-foreground/70 hover:text-sidebar-foreground"
            onClick={() => setModalOpen(true)}
            aria-label="Edit goal"
          >
            <PencilIcon className="size-3.5" />
          </Button>
        }
      >
        {!isHydrated ? (
          <div className="h-4 w-3/4 animate-pulse rounded bg-sidebar-accent/50" />
        ) : (
          <GoalDisplay goal={goal} />
        )}
      </SidebarSection>
      <GoalsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        goal={goal}
        onGoalChange={handleGoalChange}
      />
    </>
  );
}
