"use client";

import { SidebarSection } from "@/components/ui/sidebar";
import { useCourseHistory } from "@/lib/courses";

export function CourseHistorySection() {
  const courses = useCourseHistory();
  const accepted = courses.filter((c) => c.status === "accepted");
  const rejected = courses.filter((c) => c.status === "rejected");

  if (courses.length === 0) {
    return (
      <SidebarSection title="Course History">
        <p className="px-3 py-2 text-muted-foreground text-xs">
          No courses yet. Accept or reject recommendations to build your
          history.
        </p>
      </SidebarSection>
    );
  }

  return (
    <SidebarSection title="Course History">
      <div className="space-y-4 p-1">
        {accepted.length > 0 && (
          <div className="space-y-2">
            <div className="px-2 text-xs font-medium text-muted-foreground">
              Accepted
            </div>
            {accepted.map((course) => (
              <div
                key={course.id}
                className="relative flex w-full items-center rounded-md border border-border bg-background/60 p-2 pr-7"
              >
                <div className="truncate text-xs font-medium">
                  {course.title}
                </div>
                <div
                  className="absolute right-2 text-sm font-semibold"
                  style={{ color: "var(--course-accept)" }}
                >
                  ✓
                </div>
              </div>
            ))}
          </div>
        )}
        {rejected.length > 0 && (
          <div className="space-y-2">
            <div className="px-2 text-xs font-medium text-muted-foreground">
              Rejected
            </div>
            {rejected.map((course) => (
              <div
                key={course.id}
                className="relative flex w-full items-center rounded-md border border-border bg-background/60 p-2 pr-7"
              >
                <div className="truncate text-xs font-medium">
                  {course.title}
                </div>
                <div
                  className="absolute right-2 text-sm font-semibold"
                  style={{ color: "var(--course-reject)" }}
                >
                  ✕
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SidebarSection>
  );
}
