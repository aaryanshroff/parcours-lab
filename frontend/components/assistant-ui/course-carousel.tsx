"use client";

import { useState, type FC } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
} from "lucide-react";
import type { RecommendedCourse } from "@/lib/types";
import { addCourse, isCourseRecorded } from "@/lib/courses";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

const CourseCard: FC<{ course: RecommendedCourse }> = ({ course }) => {
  const title = course.title || "Untitled course";
  const [recorded, setRecorded] = useState(() => isCourseRecorded(title));

  const handle = (status: "accepted" | "rejected") => {
    addCourse({ title, status });
    setRecorded(true);
  };

  const meta: string[] = [];
  if (course.provider) meta.push(course.provider);
  if (course.level && course.level !== "unknown") meta.push(course.level);
  if (course.format) meta.push(course.format);

  const details: string[] = [];
  if (course.duration_hours && course.duration_hours > 0)
    details.push(`${course.duration_hours} hrs`);
  if (course.price) details.push(course.price);
  if (course.certificate) details.push("Certificate");
  if (course.rating != null) details.push(`${course.rating.toFixed(1)}/5`);
  if (course.language) details.push(course.language.toUpperCase());

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

      {/* Meta badges */}
      {meta.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {meta.map((m) => (
            <span
              key={m}
              className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
            >
              {m}
            </span>
          ))}
        </div>
      )}

      {/* Details line */}
      {details.length > 0 && (
        <p className="mb-2 text-xs text-muted-foreground">
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
        <div className="mb-3">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Skills:
          </p>
          <div className="flex flex-wrap gap-1">
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
        </div>
      )}

      {/* Spacer to push actions to bottom */}
      <div className="mt-auto" />

      {/* Actions */}
      {recorded ? (
        <p className="mt-3 text-muted-foreground text-xs">Saved to history</p>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => handle("accepted")}
            className="rounded-md px-3 py-1.5 font-medium text-white text-xs transition-colors"
            style={{ backgroundColor: "var(--course-accept)" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--course-accept-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--course-accept)")}
          >
            Accept
          </button>
          <button
            onClick={() => handle("rejected")}
            className="rounded-md px-3 py-1.5 font-medium text-white text-xs transition-colors"
            style={{ backgroundColor: "var(--course-reject)" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--course-reject-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--course-reject)")}
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
      <CourseCard key={currentCourse.id || currentCourse.title || currentIndex} course={currentCourse} />

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
