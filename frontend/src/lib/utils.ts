import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui convention: merge Tailwind class strings with dedup. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Simple id — good enough for message keys in the UI. */
export function nanoId(prefix = "id"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
