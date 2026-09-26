import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function expectedDurationSeconds(duration: number): number | undefined {
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  const seconds = Math.round(duration);
  return seconds >= 1 && seconds <= 86_400 ? seconds : undefined;
}
