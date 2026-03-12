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
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AssistantIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react";
import { useRef, useEffect, useState, useCallback, type FC } from "react";
import type { RecommendedCourse, ProfileUpdate } from "@/lib/types";
import { addCourse, isCourseRecorded } from "@/lib/courses";

const EMPTY_RECOMMENDED_COURSES: RecommendedCourse[] = [];
const EMPTY_PROFILE_UPDATES: ProfileUpdate[] = [];

/* ── localStorage keys (same as onboarding.tsx) ───────────────── */
const GOAL_KEY = "parcours-goal";
const KNOWN_SKILLS_KEY = "parcours-known-skills";
const REQUIRED_SKILLS_KEY = "parcours-required-skills";

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, items: string[]) {
  localStorage.setItem(key, JSON.stringify(items));
}

/** Apply a single ProfileUpdate to localStorage and return the undo function. */
function applyProfileUpdate(upd: ProfileUpdate): () => void {
  const fieldKey =
    upd.field === "goal"
      ? GOAL_KEY
      : upd.field === "current_skills"
        ? KNOWN_SKILLS_KEY
        : REQUIRED_SKILLS_KEY;

  if (upd.field === "goal") {
    const prev = localStorage.getItem(GOAL_KEY) || "";
    const newGoal = typeof upd.value === "string" ? upd.value : upd.value.join(" ");
    localStorage.setItem(GOAL_KEY, newGoal);
    return () => localStorage.setItem(GOAL_KEY, prev);
  }

  // Skill list fields
  const prev = readList(fieldKey);

  if (upd.action === "add") {
    const toAdd = Array.isArray(upd.value) ? upd.value : [upd.value];
    const merged = [...prev, ...toAdd.filter((v) => !prev.includes(v))];
    writeList(fieldKey, merged);
  } else if (upd.action === "remove") {
    const toRemove = new Set(Array.isArray(upd.value) ? upd.value : [upd.value]);
    writeList(fieldKey, prev.filter((v) => !toRemove.has(v)));
  } else {
    // set
    const newList = Array.isArray(upd.value) ? upd.value : [upd.value];
    writeList(fieldKey, newList);
  }

  return () => writeList(fieldKey, prev);
}

/* ── Human-readable label helpers ─────────────────────────────── */
const FIELD_LABELS: Record<string, string> = {
  goal: "Goal",
  current_skills: "Current skills",
  required_skills: "Skills to learn",
};

const ACTION_LABELS: Record<string, string> = {
  add: "Add",
  remove: "Remove",
  set: "Set",
};

const CourseCard: FC<{ course: RecommendedCourse }> = ({ course }) => {
  const title = course.title || "Untitled course";
  const [recorded, setRecorded] = useState(() => isCourseRecorded(title));

  const handle = (status: "accepted" | "rejected") => {
    addCourse({ title, status });
    setRecorded(true);
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
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => handle("accepted")}
            className="rounded-md bg-emerald-500 px-3 py-1.5 font-medium text-white text-xs hover:bg-emerald-600"
          >
            Accept
          </button>
          <button
            onClick={() => handle("rejected")}
            className="rounded-md bg-red-500 px-3 py-1.5 font-medium text-white text-xs hover:bg-red-600"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
};

/* ── Profile Update Card ──────────────────────────────────────── */

type ProfileUpdateGroupProps = {
  updates: ProfileUpdate[];
};

const ProfileUpdateGroup: FC<ProfileUpdateGroupProps> = ({ updates }) => {
  const [status, setStatus] = useState<"pending" | "confirmed" | "reverted">("pending");
  const undosRef = useRef<Array<() => void>>([]);

  const handleConfirm = useCallback(() => {
    const undos: Array<() => void> = [];
    for (const upd of updates) {
      undos.push(applyProfileUpdate(upd));
    }
    undosRef.current = undos;
    setStatus("confirmed");
  }, [updates]);

  const handleRevert = useCallback(() => {
    // If already confirmed, undo the applied changes
    for (const undo of [...undosRef.current].reverse()) {
      undo();
    }
    undosRef.current = [];
    setStatus("reverted");
  }, []);

  return (
    <div className="rounded-xl border border-border bg-background/80 p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          Profile Update
        </span>
        {status === "confirmed" && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            ✓ Applied
          </span>
        )}
        {status === "reverted" && (
          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            ↺ Reverted
          </span>
        )}
      </div>

      <ul className="space-y-1.5 text-sm">
        {updates.map((upd, i) => {
          const fieldLabel = FIELD_LABELS[upd.field] || upd.field;
          const actionLabel = ACTION_LABELS[upd.action] || upd.action;
          const displayValue = Array.isArray(upd.value) ? upd.value.join(", ") : upd.value;

          return (
            <li key={`${upd.field}-${upd.action}-${i}`} className="flex items-start gap-2">
              <span className="font-medium text-muted-foreground shrink-0">{actionLabel}</span>
              <span>
                <span className="font-semibold">{fieldLabel}</span>
                {upd.action === "set" ? (
                  <span className="ml-1">→ {displayValue}</span>
                ) : (
                  <span className="ml-1">
                    {upd.action === "add" ? "+" : "−"} {displayValue}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {status === "pending" && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleConfirm}
            className="rounded-md bg-emerald-500 px-3 py-1.5 font-medium text-white text-xs hover:bg-emerald-600 transition-colors"
          >
            Confirm
          </button>
          <button
            onClick={() => setStatus("reverted")}
            className="rounded-md bg-zinc-200 dark:bg-zinc-700 px-3 py-1.5 font-medium text-zinc-700 dark:text-zinc-200 text-xs hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {status === "confirmed" && (
        <div className="pt-1">
          <button
            onClick={handleRevert}
            className="rounded-md bg-amber-100 dark:bg-amber-900/30 px-3 py-1.5 font-medium text-amber-700 dark:text-amber-300 text-xs hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
          >
            Undo changes
          </button>
        </div>
      )}
    </div>
  );
};

export const Thread: FC = () => {
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
        <AssistantIf condition={({ thread }) => thread.isEmpty}>
          <ThreadWelcome />
        </AssistantIf>

        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            EditComposer,
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

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mx-auto my-auto flex w-full max-w-(--thread-max-width) grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col justify-center px-4">
          <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in font-semibold text-2xl duration-200">
            Hello there!
          </h1>
          <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in text-muted-foreground text-xl delay-75 duration-200">
            How can I help you today?
          </p>
        </div>
      </div>
    </div>
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

  const profileUpdates = useAuiState(({ message }) => {
    const dataPart = message.parts.find(
      (part) => part.type === "data" && part.name === "profile_updates",
    );

    if (!dataPart || !("data" in dataPart) || !Array.isArray(dataPart.data)) {
      return EMPTY_PROFILE_UPDATES;
    }

    return dataPart.data as ProfileUpdate[];
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

        {profileUpdates.length > 0 && (
          <div className="mt-4">
            <ProfileUpdateGroup updates={profileUpdates} />
          </div>
        )}

        {recommendedCourses.length > 0 && (
          <div className="mt-4 space-y-3">
            {recommendedCourses.map((course, index) => (
              <CourseCard key={course.id || `${course.title || "course"}-${index}`} course={course} />
            ))}
          </div>
        )}
      </div>

      <div className="aui-assistant-message-footer mt-1 ml-2 flex">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground data-floating:absolute data-floating:rounded-md data-floating:border data-floating:bg-background data-floating:p-1 data-floating:shadow-sm"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AssistantIf condition={({ message }) => message.isCopied}>
            <CheckIcon />
          </AssistantIf>
          <AssistantIf condition={({ message }) => !message.isCopied}>
            <CopyIcon />
          </AssistantIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            className="data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
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
        <div className="aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2">
          {false && <UserActionBar />}
        </div>
      </div>

      <BranchPicker className="aui-user-branch-picker col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="aui-user-action-edit p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root className="aui-edit-composer-wrapper mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2 py-3">
      <ComposerPrimitive.Root className="aui-edit-composer-root ml-auto flex w-full max-w-[85%] flex-col rounded-2xl bg-muted">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input min-h-14 w-full resize-none bg-transparent p-4 text-foreground text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">Update</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root mr-2 -ml-2 inline-flex items-center text-muted-foreground text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
