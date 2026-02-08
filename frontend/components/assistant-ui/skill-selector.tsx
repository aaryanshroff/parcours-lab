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
import { SKILLS_LIST } from "@/lib/skills";

export function SkillSelector({ selected }: { selected: string[] }) {
  return (
    <div className="flex flex-col gap-3 py-1">
      <div className="flex flex-wrap items-center gap-2">
        {selected.map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center rounded-full bg-sidebar-accent px-3 py-1 text-sm font-medium text-sidebar-accent-foreground"
          >
            {skill}
          </span>
        ))}
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
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const searchResults = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const notSelected = SKILLS_LIST.filter((s) => !selected.includes(s));
    return notSelected.filter((s) => s.toLowerCase().includes(q));
  }, [selected, query]);

  const remove = (skill: string) => {
    onSelectedChange(selected.filter((s) => s !== skill));
  };

  const add = (skill: string) => {
    if (!selected.includes(skill)) onSelectedChange([...selected, skill]);
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-visible sm:max-w-lg">
        <div className="flex flex-col gap-4">
          <DialogTitle>Manage skills</DialogTitle>
          <div className="relative">
            <Input
              ref={inputRef}
              placeholder="Search to find new skills"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9"
            />
            {query.trim().length > 0 && (
              <ul className="absolute top-full left-0 right-0 z-10 mt-1 max-h-48 overflow-auto rounded-md border bg-background shadow-md">
                {searchResults.length === 0 ? (
                  <li className="px-3 py-2 text-muted-foreground text-sm">
                    No matching skills
                  </li>
                ) : (
                  searchResults.map((skill) => (
                    <li key={skill}>
                      <button
                        type="button"
                        onClick={() => add(skill)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
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
                  className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1 text-sm"
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

export function SkillsSection() {
  const [selected, setSelected] = React.useState<string[]>([]);
  const [modalOpen, setModalOpen] = React.useState(false);

  return (
    <>
      <SidebarSection
        title="Known Skills"
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
        <SkillSelector selected={selected} />
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
