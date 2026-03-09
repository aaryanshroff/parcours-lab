"use client";

import { useState, type FC } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import type { RecommendedCourse } from "@/lib/types";
import { addCourse, isCourseRecorded } from "@/lib/courses";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CourseCard: FC<{ course: RecommendedCourse }> = ({ course }) => {
  const title = course.title || "Untitled course";
  const [recordedStatus, setRecordedStatus] = useState<
    "accepted" | "rejected" | null
  >(() => (isCourseRecorded(title) ? "accepted" : null));
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const handleAccept = () => {
    addCourse({
      title,
      status: "accepted",
      provider: course.provider,
      url: course.url,
      summary: course.summary,
      level: course.level,
      format: course.format,
      duration_hours: course.duration_hours,
      price: course.price,
      rating: course.rating,
      certificate: course.certificate,
      skills: course.skills,
    });
    setRecordedStatus("accepted");
  };

  const handleRejectSubmit = () => {
    addCourse({
      title,
      status: "rejected",
      rejection_reason: rejectReason.trim() || undefined,
      provider: course.provider,
      url: course.url,
      summary: course.summary,
      level: course.level,
      format: course.format,
      duration_hours: course.duration_hours,
      price: course.price,
      rating: course.rating,
      certificate: course.certificate,
      skills: course.skills,
    });
    setRecordedStatus("rejected");
  };

  const subtitle: string[] = [];
  if (course.provider) subtitle.push(course.provider);
  if (course.level && course.level !== "unknown")
    subtitle.push(capitalize(course.level));
  if (course.format) subtitle.push(capitalize(course.format));

  const details: string[] = [];
  if (course.duration_hours && course.duration_hours > 0)
    details.push(`${course.duration_hours} hrs`);
  if (course.price) details.push(course.price);
  if (course.rating != null) details.push(`★ ${course.rating.toFixed(1)}`);
  if (course.certificate) details.push("Certificate included");

  return (
    <div className="flex flex-col rounded-xl border border-border bg-background/80 p-4 shadow-sm">
      {/* Title */}
      <div className="mb-2">
        <span className="inline font-semibold text-sm leading-snug">
          {course.url ? (
            <a
              href={course.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:underline"
            >
              {title}
            </a>
          ) : (
            title
          )}
          {course.explanation && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ml-1.5 inline-flex size-4 -translate-y-px cursor-help items-center justify-center rounded-full border border-border text-[10px] font-normal text-muted-foreground">
                  ?
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64">
                <p className="font-semibold text-xs">Why this course?</p>
                <p className="mt-0.5 text-xs">{course.explanation}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      </div>

      {/* Subtitle */}
      {subtitle.length > 0 && (
        <p className="mb-2 text-xs text-muted-foreground">
          {subtitle.join(" · ")}
        </p>
      )}

      {/* Details */}
      {details.length > 0 && (
        <p className="mb-2 text-xs text-muted-foreground/80">
          {details.join(" · ")}
        </p>
      )}

      {/* Summary */}
      {course.summary && (
        <p className="mb-3 text-muted-foreground text-sm leading-relaxed">
          {course.summary}
        </p>
      )}

      {/* Skills */}
      {course.skills && course.skills.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {course.skills.slice(0, 5).map((skill, i) => (
            <span
              key={i}
              className="max-w-35 truncate rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
              title={skill.name}
            >
              {skill.name}
            </span>
          ))}
          {course.skills.length > 5 && (
            <span className="px-1 text-[11px] text-muted-foreground/60">
              +{course.skills.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* Spacer to push actions to bottom */}
      <div className="mt-auto" />

      {/* Actions */}
      {recordedStatus !== null ? (
        <p className="mt-3 text-muted-foreground text-xs capitalize">
          {recordedStatus}
        </p>
      ) : showRejectForm ? (
        <div className="mt-1 flex flex-col gap-2">
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why are you rejecting this course? (optional)"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            rows={2}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleRejectSubmit}
              className="rounded-md px-3 py-1.5 font-medium text-white text-xs transition-colors"
              style={{ backgroundColor: "var(--course-reject)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor =
                  "var(--course-reject-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "var(--course-reject)")
              }
            >
              Submit
            </button>
            <button
              onClick={() => {
                setShowRejectForm(false);
                setRejectReason("");
              }}
              className="rounded-md px-3 py-1.5 font-medium text-xs text-muted-foreground transition-colors hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={handleAccept}
            className="rounded-md px-3 py-1.5 font-medium text-white text-xs transition-colors"
            style={{ backgroundColor: "var(--course-accept)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor =
                "var(--course-accept-hover)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "var(--course-accept)")
            }
          >
            Accept
          </button>
          <button
            onClick={() => setShowRejectForm(true)}
            className="rounded-md px-3 py-1.5 font-medium text-white text-xs transition-colors"
            style={{ backgroundColor: "var(--course-reject)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor =
                "var(--course-reject-hover)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "var(--course-reject)")
            }
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
};

export const CourseCarousel: FC<{ courses: RecommendedCourse[] }> = ({
  courses,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const goToPrevious = () => {
    setCurrentIndex((i) => (i - 1 + courses.length) % courses.length);
  };

  const goToNext = () => {
    setCurrentIndex((i) => (i + 1) % courses.length);
  };

  const currentCourse = courses[currentIndex];

  return (
    <div className="mt-4">
      <CourseCard
        key={currentCourse.id || currentCourse.title || currentIndex}
        course={currentCourse}
      />

      {courses.length > 1 && (
        <div className="mt-2 flex items-center justify-center gap-2">
          <button
            onClick={goToPrevious}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Previous course"
          >
            <ChevronLeftIcon className="size-3.5" />
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {currentIndex + 1} / {courses.length}
          </span>
          <button
            onClick={goToNext}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Next course"
          >
            <ChevronRightIcon className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
