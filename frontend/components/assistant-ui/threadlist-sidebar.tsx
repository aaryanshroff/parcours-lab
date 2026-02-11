import * as React from "react";
import { Github } from "lucide-react";
import Link from "next/link";
import { useAuiState } from "@assistant-ui/react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSection,
} from "@/components/ui/sidebar";
import { COURSES } from "@/lib/courses";
import { ThreadList } from "@/components/assistant-ui/thread-list";
import { SkillsSection } from "@/components/assistant-ui/skill-selector";
import { GoalsSection } from "@/components/assistant-ui/goals-section";

export function ThreadListSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const [currentGoal, setCurrentGoal] = React.useState("");
  const [knownSkills, setKnownSkills] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const isRunning = useAuiState(({ thread }) => thread.isRunning);

  const textareaBaseClasses =
    "w-full rounded-md border border-input bg-muted/40 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <Sidebar {...props} className="h-screen">
      {/* Header */}
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="text-sm font-semibold">Your Profile</div>
      </SidebarHeader>

      <SidebarContent className="aui-sidebar-content px-2">
        <GoalsSection />
        <SkillsSection />
        <SidebarSection title="Threads">
          <ThreadList />
        </SidebarSection>
      </SidebarContent>

      <SidebarGroup className="p-1">
        <SidebarGroupLabel>Course History</SidebarGroupLabel>

        <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-3">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Accepted
            </div>
            {COURSES.filter((c) => c.status === "accepted").map((course) => (
              <div
                key={course.id}
                className="relative flex items-center gap-3 rounded-md border border-border bg-background/60 p-2"
              >
                <div className="h-10 w-10 shrink-0 rounded-md bg-muted" />
                <div className="text-sm font-medium">{course.title}</div>
                <div className="absolute right-2 text-sm font-semibold text-emerald-500">
                  ✓
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Rejected
            </div>
            {COURSES.filter((c) => c.status === "rejected").map((course) => (
              <div
                key={course.id}
                className="relative flex items-center gap-3 rounded-md border border-border bg-background/60 p-2"
              >
                <div className="h-10 w-10 shrink-0 rounded-md bg-muted" />
                <div className="text-sm font-medium">{course.title}</div>
                <div className="absolute right-2 text-sm font-semibold text-destructive">
                  ✕
                </div>
              </div>
            ))}
          </div>
        </div>
      </SidebarGroup>

      {/* Footer */}
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link
                href="https://github.com/assistant-ui/assistant-ui"
                target="_blank"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-background text-foreground">
                  <Github size={16} />
                </div>
                <div className="aui-sidebar-footer-heading flex flex-col gap-0.5 leading-none">
                  <span className="aui-sidebar-footer-title font-semibold">
                    John Doe
                  </span>
                  <span>Free</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
