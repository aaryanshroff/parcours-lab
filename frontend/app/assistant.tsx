"use client";

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
import { API_BASE_URL } from "@/lib/api";
import type { ChatResponse, RecommendedCourse } from "@/lib/types";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

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

    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, goal, required_skills: requiredSkills }),
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

    return {
      content,
    };
  },
};

export const Assistant = () => {
  const runtime = useLocalRuntime(backendChatAdapter);
  const { isComplete, isLoaded, markComplete, reset } = useOnboardingComplete();

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {!isLoaded ? null : !isComplete ? (
        <Onboarding onComplete={markComplete} />
      ) : (
        <SidebarProvider>
          <div className="flex h-dvh w-full pr-0.5">
            <ThreadListSidebar onLogout={reset} />
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
