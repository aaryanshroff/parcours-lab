"use client";

import { useState } from "react";
import { SidebarSection } from "@/components/ui/sidebar";
import { useCourseHistory, type Course, type CourseProgress } from "@/lib/courses";
import { CourseDetailModal } from "@/components/assistant-ui/course-detail-modal";

function getProgress(course: Course): CourseProgress {
  return course.progress ?? (course.done ? "done" : "not_started");
}

const PROGRESS_LABEL: Record<CourseProgress, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  done: "Completed",
};

export function CourseHistorySection() {
  const courses = useCourseHistory();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedCourse = selectedId ? courses.find((c) => c.id === selectedId) ?? null : null;

  const accepted = courses.filter((c) => c.status === "accepted");
  const rejected = courses.filter((c) => c.status === "rejected");

  // Sort: not_started first, in_progress next, done last
  const progressOrder: Record<CourseProgress, number> = {
    not_started: 0,
    in_progress: 1,
    done: 2,
  };
  const sortedAccepted = [...accepted].sort(
    (a, b) => progressOrder[getProgress(a)] - progressOrder[getProgress(b)],
  );

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
    <>
      <SidebarSection title="Course History">
        <div className="space-y-4 p-1">
          {sortedAccepted.length > 0 && (
            <div className="space-y-2">
              <div className="px-2 text-xs font-medium text-muted-foreground">
                Accepted
              </div>
              {sortedAccepted.map((course) => {
                const progress = getProgress(course);
                const isDone = progress === "done";
                return (
                  <button
                    key={course.id}
                    type="button"
                    onClick={() => setSelectedId(course.id)}
                    className={`relative flex w-full items-center rounded-md border border-border bg-background/60 p-2 pr-20 text-left transition-colors hover:bg-accent ${isDone ? "opacity-50" : ""}`}
                  >
                    <div className={`truncate text-xs ${isDone ? "line-through" : ""}`}>
                      {course.provider && (
                        <span className="font-semibold">{course.provider}: </span>
                      )}
                      <span className="font-medium">{course.title}</span>
                    </div>
                    <span
                      className="absolute right-2 text-[10px] font-medium"
                      style={{ color: "var(--course-accept)" }}
                    >
                      {PROGRESS_LABEL[progress]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {rejected.length > 0 && (
            <div className="space-y-2">
              <div className="px-2 text-xs font-medium text-muted-foreground">
                Rejected
              </div>
              {rejected.map((course) => (
                <button
                  key={course.id}
                  type="button"
                  onClick={() => setSelectedId(course.id)}
                  className="relative flex w-full items-center rounded-md border border-border bg-background/60 p-2 pr-20 text-left transition-colors hover:bg-accent"
                >
                  <div className="truncate text-xs">
                    {course.provider && (
                      <span className="font-semibold">{course.provider}: </span>
                    )}
                    <span className="font-medium">{course.title}</span>
                  </div>
                  <span
                    className="absolute right-2 text-[10px] font-medium"
                    style={{ color: "var(--course-reject)" }}
                  >
                    Rejected
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </SidebarSection>

      <CourseDetailModal
        course={selectedCourse}
        open={selectedCourse !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </>
  );
}
