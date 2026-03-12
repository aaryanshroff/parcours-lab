import { useSyncExternalStore } from "react";

export type CourseProgress = "not_started" | "in_progress" | "done";

export type Course = {
  id: string;
  title: string;
  status: "accepted" | "rejected";
  progress?: CourseProgress;
  done?: boolean; // deprecated, kept for backward compat
  provider?: string;
  url?: string;
  summary?: string;
  level?: string;
  format?: string;
  duration_hours?: number | null;
  price?: string;
  rating?: number | null;
  certificate?: boolean;
  rejection_reason?: string;
  skills?: Array<{ name: string; esco_uri?: string; description?: string }>;
};

const STORAGE_KEY = "parcours-course-history";

let listeners: Array<() => void> = [];

function load(): Course[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(courses: Course[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(courses));
  for (const l of listeners) l();
}

let snapshot: Course[] = [];
if (typeof window !== "undefined") {
  snapshot = load();
}

function getSnapshot(): Course[] {
  return snapshot;
}

function getServerSnapshot(): Course[] {
  return [];
}

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function addCourse(course: Omit<Course, "id">) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  snapshot = [...snapshot, { ...course, id }];
  save(snapshot);
}

export function isCourseRecorded(title: string): boolean {
  return snapshot.some((c) => c.title === title);
}

export function updateCourseProgress(id: string, progress: CourseProgress) {
  snapshot = snapshot.map((c) =>
    c.id === id ? { ...c, progress, done: progress === "done" } : c,
  );
  save(snapshot);
}

export function rejectCourse(id: string) {
  snapshot = snapshot.map((c) =>
    c.id === id ? { ...c, status: "rejected" as const, progress: undefined, done: false } : c,
  );
  save(snapshot);
}

export function reacceptCourse(id: string) {
  snapshot = snapshot.map((c) =>
    c.id === id ? { ...c, status: "accepted" as const, progress: "not_started" as const, done: false } : c,
  );
  save(snapshot);
}

export function useCourseHistory(): Course[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}