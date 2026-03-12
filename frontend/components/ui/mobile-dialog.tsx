"use client";

import * as React from "react";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function MobileDialogContent({
  title,
  children,
  className,
  ...props
}: ComponentProps<typeof DialogContent> & { title: string }) {
  return (
    <DialogContent
      className={cn(
        "fixed inset-0 z-50 h-dvh w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0 overflow-visible duration-0 md:inset-auto md:top-1/2 md:left-1/2 md:h-auto md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:duration-200",
        className,
      )}
      onOpenAutoFocus={(e) => e.preventDefault()}
      {...props}
    >
      <div className="flex h-full flex-col gap-4 overflow-visible md:h-auto ">
        <DialogTitle className="pl-1">{title}</DialogTitle>
        <DialogDescription className="sr-only">{title}</DialogDescription>
        {children}
      </div>
    </DialogContent>
  );
}
