import * as React from "react";
import { Github } from "lucide-react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { SkillsSection, RequiredSkillsSection } from "@/components/assistant-ui/skill-selector";
import { GoalsSection } from "@/components/assistant-ui/goals-section";
import { CourseHistorySection } from "@/components/assistant-ui/course-history";

export function ThreadListSidebar({
  onReset,
  ...props
}: React.ComponentProps<typeof Sidebar> & { onReset: () => void }) {
  const [email, setEmail] = React.useState<string | null>(null);

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setEmail(session?.user?.email ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <Sidebar {...props}>
<SidebarContent className="px-2">
        <GoalsSection />
        <SkillsSection />
        <RequiredSkillsSection />
        <CourseHistorySection />
      </SidebarContent>
      <SidebarRail />
      <SidebarFooter className="border-t">
        <SidebarMenu>
          {email ? (
            <>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <Github className="size-4" />
                  </div>
                  <span className="truncate text-sm font-medium">{email}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="sm"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    onReset();
                  }}
                >
                  Sign out
                </SidebarMenuButton>
              </SidebarMenuItem>
            </>
          ) : (
            <SidebarMenuItem>
              <SidebarMenuButton size="sm" asChild>
                <Link href="/login">Save progress — sign in</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
