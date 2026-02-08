"use client";

import * as React from "react";
import { PencilIcon, XIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { SidebarSection } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SKILLS_LIST, SUGGESTED_SKILLS } from "@/lib/skills";

const MAX_VISIBLE_SKILLS = 15;

export function SkillSelector({
  selected,
  className,
  onMoreClick,
}: {
  selected: string[];
  className?: string;
  onMoreClick?: () => void;
}) {
  const visible = selected.slice(0, MAX_VISIBLE_SKILLS);
  const hasMore = selected.length > MAX_VISIBLE_SKILLS;

  return (
    <div className={cn("flex flex-col gap-3 py-1", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {visible.map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center rounded-full bg-sidebar-accent px-3 py-1 text-xs font-medium text-sidebar-accent-foreground"
          >
            {skill}
          </span>
        ))}
        {hasMore && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onMoreClick}
                className="inline-flex items-center rounded-full bg-sidebar-accent/70 px-2 py-1 text-xs font-medium text-sidebar-accent-foreground/80 hover:bg-sidebar-accent focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="View all"
              >
                ...
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">View all</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function KnownSkillsSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
    </div>
  );
}

function SkillsModal({
  open,
  onOpenChange,
  selected,
  onSelectedChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string[];
  onSelectedChange: (selected: string[]) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const [isSearchFocused, setIsSearchFocused] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedIndex(0);
      setIsSearchFocused(false);
    }
  }, [open]);

  const searchResults = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const notSelected = SKILLS_LIST.filter((s) => !selected.includes(s));
    return notSelected.filter((s) => s.toLowerCase().includes(q));
  }, [selected, query]);

  const suggestedSkills = React.useMemo(
    () => SUGGESTED_SKILLS.filter((s) => !selected.includes(s)),
    [selected],
  );

  const showDropdown =
    isSearchFocused && (query.trim().length > 0 || suggestedSkills.length > 0);
  const dropdownList =
    query.trim().length > 0 ? searchResults : suggestedSkills;
  const isEmptyDropdown =
    query.trim().length > 0 ? searchResults.length === 0 : false;

  React.useEffect(() => {
    setHighlightedIndex(0);
  }, [query, dropdownList.length]);

  React.useEffect(() => {
    if (dropdownList.length === 0) return;
    const el = listRef.current?.querySelector(
      `[data-index="${highlightedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, dropdownList.length]);

  const remove = (skill: string) => {
    onSelectedChange(selected.filter((s) => s !== skill));
  };

  const add = (skill: string) => {
    if (!selected.includes(skill)) onSelectedChange([...selected, skill]);
    setQuery("");
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (dropdownList.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, dropdownList.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const skill = dropdownList[highlightedIndex];
      if (skill) add(skill);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="fixed inset-0 z-50 h-dvh w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0 overflow-visible md:inset-auto md:top-1/2 md:left-1/2 md:h-auto md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex h-full flex-col gap-4 overflow-auto md:h-auto">
          <DialogTitle className="pl-1">Manage skills</DialogTitle>
          <div className="relative">
            <Input
              ref={inputRef}
              placeholder="Search to find new skills"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setTimeout(() => setIsSearchFocused(false), 150)}
              onKeyDown={handleInputKeyDown}
              className="h-9"
            />
            {showDropdown && (
              <ul
                ref={listRef}
                className="absolute top-full left-0 right-0 z-10 mt-1 max-h-48 overflow-auto rounded-md border bg-background shadow-md"
              >
                {isEmptyDropdown ? (
                  <li className="px-3 py-2 text-muted-foreground text-sm">
                    No matching skills
                  </li>
                ) : (
                  dropdownList.map((skill, index) => (
                    <li key={skill}>
                      <button
                        type="button"
                        data-index={index}
                        onClick={() => add(skill)}
                        className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${
                          index === highlightedIndex ? "bg-muted" : ""
                        }`}
                      >
                        {skill}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {selected.length > 0 ? (
              selected.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 rounded-md border bg-muted/50 pl-2.5 pr-1 py-1 text-sm"
                >
                  {skill}
                  <button
                    type="button"
                    onClick={() => remove(skill)}
                    className="rounded p-0.5 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label={`Remove ${skill}`}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </span>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">
                Add skills using the search above.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// saving to local storage -- edit upon account implementation --------------------------
const KNOWN_SKILLS_STORAGE_KEY = "parcours-known-skills";

function loadKnownSkills(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KNOWN_SKILLS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((s) => typeof s === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function saveKnownSkills(skills: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KNOWN_SKILLS_STORAGE_KEY,
      JSON.stringify(skills),
    );
  } catch {
    // ignore
  }
}

// --------------------------------------------------------------------------
export function SkillsSection() {
  const [selected, setSelected] = React.useState<string[]>([]);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [isHydrated, setIsHydrated] = React.useState(false);

  React.useEffect(() => {
    setSelected(loadKnownSkills());
    const t = setTimeout(() => setIsHydrated(true), 300);
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    if (!isHydrated) return;
    saveKnownSkills(selected);
  }, [selected, isHydrated]);

  return (
    <>
      <SidebarSection
        title="My Skills"
        action={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                onClick={() => setModalOpen(true)}
                aria-label="Edit skills"
              >
                <PencilIcon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Edit skills</TooltipContent>
          </Tooltip>
        }
      >
        {!isHydrated ? (
          <KnownSkillsSkeleton />
        ) : (
          <SkillSelector
            selected={selected}
            className="animate-in fade-in-0 duration-200"
            onMoreClick={() => setModalOpen(true)}
          />
        )}
      </SidebarSection>
      <SkillsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        selected={selected}
        onSelectedChange={setSelected}
      />
    </>
  );
}
