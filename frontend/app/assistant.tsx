"use client";

import { useEffect } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import {
  Onboarding,
  useOnboardingComplete,
} from "@/components/assistant-ui/onboarding";
import { Separator } from "@/components/ui/separator";
import { API_BASE_URL, authFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase/client";
import type { ChatResponse, RecommendedCourse } from "@/lib/types";
import { getCourseHistory, setCourseHistory } from "@/lib/courses";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const conversationId = crypto.randomUUID();

const backendChatAdapter: ChatModelAdapter = {
  async run({ messages, abortSignal }) {
    const goal = localStorage.getItem("parcours-goal") || "";
    const requiredSkills: string[] = (() => {
      try {
        const raw = localStorage.getItem("parcours-required-skills");
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    })();

    const courseHistory: Array<{
      title: string;
      status: string;
      reason: string;
    }> = (() => {
      try {
        const raw = localStorage.getItem("parcours-course-history");
        if (!raw) return [];
        const parsed = JSON.parse(raw) as Array<{
          title?: string;
          status?: string;
          reason?: string;
        }>;
        return Array.isArray(parsed)
          ? parsed.map((c) => ({
              title: c.title ?? "",
              status: c.status ?? "",
              reason: c.reason ?? "",
            }))
          : [];
      } catch {
        return [];
      }
    })();

    const response = await authFetch(`${API_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        goal,
        required_skills: requiredSkills,
        conversation_id: conversationId,
        course_history: courseHistory,
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      let errorMessage = `Chat request failed (${response.status})`;
      try {
        const errorData = (await response.json()) as ChatResponse;
        if (typeof errorData.error === "string" && errorData.error.trim()) {
          errorMessage = errorData.error;
        }
      } catch {
        // Response was not JSON; keep status-based error.
      }
      throw new Error(errorMessage);
    }

    let data: ChatResponse;
    try {
      data = (await response.json()) as ChatResponse;
    } catch {
      throw new Error("Chat response was not valid JSON");
    }

    const content: Array<
      | { type: "text"; text: string }
      | { type: "data"; name: string; data: RecommendedCourse[] }
    > = [{ type: "text", text: data.response }];

    if (data.recommended_courses?.length) {
      content.push({
        type: "data",
        name: "recommended_courses",
        data: data.recommended_courses,
      });
    }

    // Persist turn to localStorage so it can be flushed to DB on sign-in
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      const userText = lastUserMsg.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      const stored = JSON.parse(localStorage.getItem("parcours-messages") || "[]");
      stored.push({ role: "user", content: userText });
      stored.push({ role: "assistant", content: data.response });
      localStorage.setItem("parcours-messages", JSON.stringify(stored));
    }

    return {
      content,
    };
  },
};

export const Assistant = () => {
  const runtime = useLocalRuntime(backendChatAdapter);
  const { isComplete, isLoaded, markComplete, reset } = useOnboardingComplete();

  useEffect(() => {
    if (!isComplete) return;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      try {
        const res = await authFetch(`${API_BASE_URL}/api/conversations/me`);
        if (!res.ok) return;
        const { messages } = await res.json() as { messages: { role: "user" | "assistant"; content: string }[] };
        if (messages?.length) {
          runtime.thread.reset(messages.map((m) => ({ role: m.role, content: m.content })));
        }
      } catch {
        // No history — start fresh
      }

      try {
        const localCourses = getCourseHistory();
        const res = await authFetch(`${API_BASE_URL}/api/profile/me`);
        if (res.ok) {
          const body = await res.json() as { course_history?: typeof localCourses };
          const serverCourses = Array.isArray(body.course_history) ? body.course_history : [];
          if (serverCourses.length > 0) {
            setCourseHistory(serverCourses, { sync: false });
          } else if (localCourses.length > 0) {
            await authFetch(`${API_BASE_URL}/api/profile/save`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ course_history: localCourses }),
            });
          }
        }
      } catch {
        // Best-effort sync only.
      }
    });
  }, [runtime, isComplete]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {!isLoaded ? null : !isComplete ? (
        <Onboarding onComplete={markComplete} />
      ) : (
        <SidebarProvider>
          <div className="flex h-dvh w-full pr-0.5">
            <ThreadListSidebar onReset={reset} />
            <SidebarInset>
              <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
                <SidebarTrigger />
                <Separator orientation="vertical" className="mr-2 h-4" />
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink
                        href="https://www.assistant-ui.com/docs/getting-started"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        ParcoursLab
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>Courses for Javanese</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </header>
              <div className="flex-1 overflow-hidden">
                <Thread />
              </div>
            </SidebarInset>
          </div>
        </SidebarProvider>
      )}
    </AssistantRuntimeProvider>
  );
};
