import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Reasoning, ReasoningGroup } from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AssistantIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  SquareIcon,
} from "lucide-react";
import { useRef, useEffect, useState, type FC } from "react";
import type { RecommendedCourse } from "@/lib/types";
import { addCourse, isCourseRecorded } from "@/lib/courses";

const EMPTY_RECOMMENDED_COURSES: RecommendedCourse[] = [];

const REJECT_CHIPS = [
  "Too advanced",
  "Already taken",
  "Not relevant",
  "Wrong language",
];

const CourseCard: FC<{ course: RecommendedCourse }> = ({ course }) => {
  const title = course.title || "Untitled course";
  const [recorded, setRecorded] = useState(() => isCourseRecorded(title));
  const [rejecting, setRejecting] = useState(false);
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set());
  const [customReason, setCustomReason] = useState("");

  const handleAccept = () => {
    addCourse({ title, status: "accepted" });
    setRecorded(true);
  };

  const handleRejectSubmit = () => {
    const parts = [...selectedChips];
    if (customReason.trim()) parts.push(customReason.trim());
    addCourse({ title, status: "rejected", reason: parts.join("; ") || undefined });
    setRecorded(true);
    setRejecting(false);
  };

  const toggleChip = (chip: string) => {
    setSelectedChips((prev) => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-border bg-background/80 p-4 shadow-sm">
      {course.url ? (
        <a
          href={course.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-sm underline-offset-2 hover:underline"
        >
          {title}
        </a>
      ) : (
        <div className="font-semibold text-sm">{title}</div>
      )}
      <p className="mt-1 text-muted-foreground text-sm">
        {course.summary || "No summary available for this course yet."}
      </p>

      {recorded ? (
        <p className="mt-3 text-muted-foreground text-xs">Saved to history</p>
      ) : rejecting ? (
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground text-xs">Why not this course?</p>
          <div className="flex flex-wrap gap-1.5">
            {REJECT_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => toggleChip(chip)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  selectedChips.has(chip)
                    ? "border-red-500 bg-red-500/10 text-red-600 dark:text-red-400"
                    : "border-border text-muted-foreground hover:border-red-300 hover:text-red-500",
                )}
              >
                {chip}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={customReason}
            onChange={(e) => setCustomReason(e.target.value)}
            placeholder="Other reason (optional)"
            className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleRejectSubmit}
              className="rounded-md border border-border px-3 py-1.5 font-medium text-muted-foreground text-xs hover:bg-muted"
            >
              Submit
            </button>
            <button
              onClick={() => { setRejecting(false); setSelectedChips(new Set()); setCustomReason(""); }}
              className="rounded-md border border-border px-3 py-1.5 text-muted-foreground text-xs hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={handleAccept}
            className="rounded-md bg-emerald-500 px-3 py-1.5 font-medium text-white text-xs hover:bg-emerald-600"
          >
            Accept
          </button>
          <button
            onClick={() => setRejecting(true)}
            className="rounded-md bg-red-500 px-3 py-1.5 font-medium text-white text-xs hover:bg-red-600"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
};

const SixSecondLoadingBar: FC = () => {
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setStarted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="mt-2 w-full max-w-md" aria-label="Loading recommendations">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full bg-primary transition-all duration-[6000ms] ease-linear",
            started ? "w-full" : "w-0",
          )}
        />
      </div>
    </div>
  );
};

export const Thread: FC<{ initialRecommendationsPending?: boolean }> = ({
  initialRecommendationsPending = false,
}) => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "44rem",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="aui-thread-viewport relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4"
      >
        {initialRecommendationsPending && (
          <AssistantIf condition={({ thread }) => thread.isEmpty}>
            <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col justify-center px-4">
              <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in font-semibold text-2xl">
                Recommendations pending...
              </h1>
              <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in text-muted-foreground text-xl">
                Generating your first personalized course suggestions.
              </p>
              <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in text-muted-foreground text-m">
                This can take up to 6 seconds to load!
              </p>
              <SixSecondLoadingBar />
            </div>
          </AssistantIf>
        )}

        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
          }}
        />

        <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible rounded-t-3xl bg-background pb-4 md:pb-6">
          <ThreadScrollToBottom />
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const Composer: FC = () => {
  const isRunning = useAuiState(({ thread }) => thread.isRunning);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isRunning) {
      inputRef.current?.focus();
    }
  }, [isRunning]);

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone className="aui-composer-attachment-dropzone flex w-full flex-col rounded-2xl border border-input bg-background px-1 pt-2 outline-none transition-shadow has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-2 has-[textarea:focus-visible]:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:border-dashed data-[dragging=true]:bg-accent/50">
        <ComposerAttachments />
        <div className="flex w-full items-end gap-2">
          <ComposerPrimitive.Input
            ref={inputRef}
            placeholder="Type a message..."
            className="aui-composer-input min-h-11 flex-1 resize-none bg-transparent px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
            rows={1}
            autoFocus
            aria-label="Message input"
            disabled={isRunning}
          />
          <ComposerAction />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="aui-composer-action-wrapper relative mx-2 mb-2 flex items-center justify-between">
      <ComposerAddAttachment />

      <AssistantIf condition={({ thread }) => !thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="submit"
            variant="default"
            size="icon"
            className="aui-composer-send size-8 rounded-full"
            aria-label="Send message"
          >
            <ArrowUpIcon className="aui-composer-send-icon size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AssistantIf>

      <AssistantIf condition={({ thread }) => thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-cancel size-8 rounded-full"
            aria-label="Stop generating"
          >
            <SquareIcon className="aui-composer-cancel-icon size-3 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AssistantIf>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  const recommendedCourses = useAuiState(({ message }) => {
    const dataPart = message.parts.find(
      (part) => part.type === "data" && part.name === "recommended_courses",
    );

    if (!dataPart || !("data" in dataPart) || !Array.isArray(dataPart.data)) {
      return EMPTY_RECOMMENDED_COURSES;
    }

    return dataPart.data as RecommendedCourse[];
  });

  return (
    <MessagePrimitive.Root
      className="aui-assistant-message-root fade-in slide-in-from-bottom-1 relative mx-auto w-full max-w-(--thread-max-width) animate-in py-3 text-left duration-150"
      data-role="assistant"
    >
      <div className="aui-assistant-message-content wrap-break-word px-2 text-foreground leading-relaxed">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning,
            ReasoningGroup,
            tools: { Fallback: ToolFallback },
          }}
        />
        <MessageError />

        {recommendedCourses.length > 0 && (
          <div className="mt-4 space-y-3">
            {recommendedCourses.map((course, index) => (
              <CourseCard key={course.id || `${course.title || "course"}-${index}`} course={course} />
            ))}
          </div>
        )}
      </div>

    </MessagePrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className="aui-user-message-root fade-in slide-in-from-bottom-1 mx-auto grid w-full max-w-(--thread-max-width) animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 py-3 duration-150 [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content wrap-break-word rounded-2xl bg-muted px-4 py-2.5 text-foreground">
          <MessagePrimitive.Parts />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};
