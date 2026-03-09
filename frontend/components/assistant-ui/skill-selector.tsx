"use client";

import * as React from "react";
import { InfoIcon, PencilIcon, StarIcon, XIcon } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { MobileDialogContent } from "@/components/ui/mobile-dialog";
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
import { SKILLS_LIST, SUGGESTED_SKILLS, MAX_SKILLS } from "@/lib/skills";

function sortStarredFirst(skills: string[], starred: Set<string>): string[] {
  return [...skills].sort((a, b) => {
    const aStarred = starred.has(a) ? 0 : 1;
    const bStarred = starred.has(b) ? 0 : 1;
    return aStarred - bStarred;
  });
}

// -- Sidebar display --------------------------------------------------------

export function SkillSelector({
  selected,
  starred,
  className,
  onMoreClick,
}: {
  selected: string[];
  starred: Set<string>;
  className?: string;
  onMoreClick?: () => void;
}) {
  const sorted = sortStarredFirst(selected, starred);
  const visible = sorted.slice(0, MAX_SKILLS);
  const hasMore = selected.length > MAX_SKILLS;

  return (
    <div className={cn("flex flex-col gap-3 py-1", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {visible.map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 rounded-full bg-sidebar-accent px-3 py-1 text-xs font-medium text-sidebar-accent-foreground"
          >
            {starred.has(skill) && (
              <StarIcon className="size-3 fill-current text-amber-500" />
            )}
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

// -- Skeleton ---------------------------------------------------------------

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

// -- Modal ------------------------------------------------------------------

function SkillsModal({
  open,
  onOpenChange,
  selected,
  onSelectedChange,
  starred,
  onToggleStar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string[];
  onSelectedChange: (selected: string[]) => void;
  starred: Set<string>;
  onToggleStar: (skill: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const [isSearchFocused, setIsSearchFocused] = React.useState(false);
  const [displayOrder, setDisplayOrder] = React.useState<string[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const selectedSet = React.useMemo(() => new Set(selected), [selected]);

  const atLimit = selected.length >= MAX_SKILLS;

  // Snapshot sorted order on open; stays stable while editing
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedIndex(0);
      setIsSearchFocused(false);
      setDisplayOrder(sortStarredFirst(selected, starred));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Ordered list: snapshot order + newly added skills appended
  const orderedSelected = React.useMemo(() => {
    const ordered: string[] = [];
    for (const name of displayOrder) {
      if (selectedSet.has(name)) ordered.push(name);
    }
    for (const name of selected) {
      if (!displayOrder.includes(name)) ordered.push(name);
    }
    return ordered;
  }, [selected, selectedSet, displayOrder]);

  const searchResults = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SKILLS_LIST.filter(
      (s) => !selectedSet.has(s) && s.toLowerCase().includes(q),
    );
  }, [selectedSet, query]);

  const suggestedSkills = React.useMemo(
    () => SUGGESTED_SKILLS.filter((s) => !selectedSet.has(s)),
    [selectedSet],
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
    if (atLimit || selectedSet.has(skill)) return;
    onSelectedChange([...selected, skill]);
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
      <MobileDialogContent title="Manage skills">
        <div className="relative">
          <Input
            ref={inputRef}
            placeholder={
              atLimit
                ? `Limit of ${MAX_SKILLS} skills reached`
                : "Search to find new skills"
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setTimeout(() => setIsSearchFocused(false), 150)}
            onKeyDown={handleInputKeyDown}
            className="h-9"
            disabled={atLimit}
          />
          {showDropdown && !atLimit && (
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
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-muted-foreground text-xs">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          <p>Star a skill to mark proficiency.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {orderedSelected.length > 0 ? (
            orderedSelected.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1 rounded-md border bg-muted/50 pl-1 pr-1 py-1 text-sm"
              >
                <button
                  type="button"
                  onClick={() => onToggleStar(skill)}
                  className="inline-flex items-center gap-1 rounded transition-colors hover:bg-muted focus:outline-none"
                  aria-label={
                    starred.has(skill) ? `Unstar ${skill}` : `Star ${skill}`
                  }
                >
                  <StarIcon
                    className={cn(
                      "size-3.5 transition-colors",
                      starred.has(skill)
                        ? "fill-current text-amber-500"
                        : "text-muted-foreground/40",
                    )}
                  />
                  <span>{skill}</span>
                </button>
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
            <p className="pl-1 text-muted-foreground text-sm">
              Add skills using the search above.
            </p>
          )}
        </div>
      </MobileDialogContent>
    </Dialog>
  );
}

// -- Local storage ----------------------------------------------------------

const KNOWN_SKILLS_STORAGE_KEY = "parcours-known-skills";
const STARRED_SKILLS_STORAGE_KEY = "parcours-starred-skills";

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

function loadStarredSkills(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STARRED_SKILLS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((s) => typeof s === "string")
      ? new Set(parsed)
      : new Set();
  } catch {
    return new Set();
  }
}

function saveStarredSkills(starred: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STARRED_SKILLS_STORAGE_KEY,
      JSON.stringify([...starred]),
    );
  } catch {
    // ignore
  }
}

// -- Required skills section ------------------------------------------------

const REQUIRED_SKILLS_STORAGE_KEY = "parcours-required-skills";

function loadRequiredSkills(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(REQUIRED_SKILLS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((s) => typeof s === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function RequiredSkillsSection() {
  const [skills, setSkills] = React.useState<string[]>([]);
  const [isHydrated, setIsHydrated] = React.useState(false);

  React.useEffect(() => {
    setSkills(loadRequiredSkills());
    setIsHydrated(true);
  }, []);

  if (!isHydrated) {
    return (
      <SidebarSection title="Required Skills">
        <KnownSkillsSkeleton />
      </SidebarSection>
    );
  }

  if (skills.length === 0) return null;

  return (
    <SidebarSection title="Required Skills">
      <div className="flex flex-col gap-3 py-1 animate-in fade-in-0 duration-200">
        <div className="flex flex-wrap items-center gap-2">
          {skills.map((skill) => (
            <span
              key={skill}
              className="inline-flex items-center rounded-full bg-sidebar-accent px-3 py-1 text-xs font-medium text-sidebar-accent-foreground"
            >
              {skill}
            </span>
          ))}
        </div>
      </div>
    </SidebarSection>
  );
}

// -- Section ----------------------------------------------------------------

export function SkillsSection() {
  const [selected, setSelected] = React.useState<string[]>([]);
  const [starred, setStarred] = React.useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = React.useState(false);
  const [isHydrated, setIsHydrated] = React.useState(false);

  React.useEffect(() => {
    setSelected(loadKnownSkills());
    setStarred(loadStarredSkills());
    setIsHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!isHydrated) return;
    saveKnownSkills(selected);
  }, [selected, isHydrated]);

  React.useEffect(() => {
    if (!isHydrated) return;
    saveStarredSkills(starred);
  }, [starred, isHydrated]);

  const toggleStar = React.useCallback((skill: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  }, []);

  // Clean up starred skills that have been removed
  const handleSelectedChange = React.useCallback((newSelected: string[]) => {
    setSelected(newSelected);
    const newSet = new Set(newSelected);
    setStarred((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const s of next) {
        if (!newSet.has(s)) {
          next.delete(s);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  return (
    <>
      <SidebarSection
        title="My Skills"
        action={
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-sidebar-foreground/70 hover:text-sidebar-foreground"
            onClick={() => setModalOpen(true)}
            aria-label="Edit skills"
          >
            <PencilIcon className="size-3.5" />
          </Button>
        }
      >
        {!isHydrated ? (
          <KnownSkillsSkeleton />
        ) : (
          <SkillSelector
            selected={selected}
            starred={starred}
            className="animate-in fade-in-0 duration-200"
            onMoreClick={() => setModalOpen(true)}
          />
        )}
      </SidebarSection>
      <SkillsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        selected={selected}
        onSelectedChange={handleSelectedChange}
        starred={starred}
        onToggleStar={toggleStar}
      />
    </>
  );
}
