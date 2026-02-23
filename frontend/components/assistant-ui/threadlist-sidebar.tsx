import * as React from "react";
import { Github, MessagesSquare } from "lucide-react";
import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
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
  return (
    <Sidebar {...props}>
      <SidebarHeader className="aui-sidebar-header mb-2 border-b">
        <div className="aui-sidebar-header-content flex items-center justify-between">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                <div className="aui-sidebar-header-icon-wrapper flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <MessagesSquare className="aui-sidebar-header-icon size-4" />
                </div>
                <div className="aui-sidebar-header-heading mr-6 flex flex-col gap-0.5 leading-none">
                  <span className="aui-sidebar-header-title font-semibold">
                    Your Profile
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarHeader>
      <SidebarContent className="aui-sidebar-content px-2">
        <GoalsSection />
        <SkillsSection />
        <SidebarSection title="Course History">
          <div className="space-y-4 p-3">
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
                  <div className="text-xs font-medium">{course.title}</div>
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
                  <div className="text-xs font-medium">{course.title}</div>
                  <div className="absolute right-2 text-sm font-semibold text-destructive">
                    ✕
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SidebarSection>
        <SidebarSection title="Threads">
          <ThreadList />
        </SidebarSection>
      </SidebarContent>
      <SidebarRail />
      <SidebarFooter className="aui-sidebar-footer border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link
                href="https://github.com/assistant-ui/assistant-ui"
                target="_blank"
              >
                <div className="aui-sidebar-footer-icon-wrapper flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Github className="aui-sidebar-footer-icon size-4" />
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
    </Sidebar>
  );
}
