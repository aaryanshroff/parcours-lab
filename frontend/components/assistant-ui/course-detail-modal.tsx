"use client";

import type { FC } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { MobileDialogContent } from "@/components/ui/mobile-dialog";
import type { Course, CourseProgress } from "@/lib/courses";
import { updateCourseProgress, reacceptCourse, rejectCourse } from "@/lib/courses";

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const PROGRESS_OPTIONS: { value: CourseProgress; label: string }[] = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
];

export const CourseDetailModal: FC<{
  course: Course | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ course, open, onOpenChange }) => {
  if (!course) return null;

  const subtitle: string[] = [];
  if (course.provider) subtitle.push(course.provider);
  if (course.level && course.level !== "unknown") subtitle.push(capitalize(course.level));
  if (course.format) subtitle.push(capitalize(course.format));

  const details: string[] = [];
  if (course.duration_hours && course.duration_hours > 0)
    details.push(`${course.duration_hours} hrs`);
  if (course.price) details.push(course.price);
  if (course.rating != null) details.push(`★ ${course.rating.toFixed(1)}`);
  if (course.certificate) details.push("Certificate included");

  const currentProgress: CourseProgress = course.progress ?? (course.done ? "done" : "not_started");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <MobileDialogContent title={course.title}>
        <div className="flex flex-col gap-3 overflow-y-auto px-1">
          {/* Subtitle */}
          {subtitle.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {subtitle.join(" · ")}
            </p>
          )}

          {/* Details */}
          {details.length > 0 && (
            <p className="text-sm text-muted-foreground/80">
              {details.join(" · ")}
            </p>
          )}

          {/* Summary */}
          {course.summary && (
            <p className="text-sm leading-relaxed">{course.summary}</p>
          )}

          {/* Skills */}
          {course.skills && course.skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {course.skills.map((skill, i) => (
                <span
                  key={i}
                  className="rounded bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {skill.name}
                </span>
              ))}
            </div>
          )}

          {/* Link */}
          {course.url && (
            <a
              href={course.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--course-accept)" }}
            >
              View course
              <ExternalLinkIcon className="size-3.5" />
            </a>
          )}

          {/* Progress selector (accepted courses) */}
          {course.status === "accepted" && (
            <div className="mt-1 flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                {PROGRESS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => updateCourseProgress(course.id, opt.value)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      currentProgress === opt.value
                        ? "text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                    style={
                      currentProgress === opt.value
                        ? { backgroundColor: "var(--course-accept)" }
                        : undefined
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  rejectCourse(course.id);
                  onOpenChange(false);
                }}
                className="self-start pl-1 pt-1 text-[11px] text-muted-foreground/70 underline-offset-2 hover:text-muted-foreground hover:underline"
              >
                Remove from list
              </button>
            </div>
          )}

          {/* Re-accept (rejected courses) */}
          {course.status === "rejected" && (
            <button
              onClick={() => {
                reacceptCourse(course.id);
                onOpenChange(false);
              }}
              className="mt-1 self-start rounded-md px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors"
              style={{ backgroundColor: "var(--course-accept)" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--course-accept-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--course-accept)")}
            >
              Add to course list
            </button>
          )}
        </div>
      </MobileDialogContent>
    </Dialog>
  );
};
