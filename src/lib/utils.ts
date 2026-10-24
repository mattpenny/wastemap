import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, resolving Tailwind conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 4620 -> "4,620" */
export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** 86.7 -> "86.7%" */
export function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/**
 * A timestamp as local wall-clock, with its offset spelled out.
 *
 * The vessel time search sets a window in local time, so the tooltips have to
 * answer in the same frame of reference — a dot reading "12:43 UTC" under a
 * picker reading "20:43" reads as a bug. The offset is printed rather than
 * implied, so the reading is still unambiguous to anyone in another zone.
 */
export function formatLocalTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())} ` +
    `(${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`
  );
}

/** Epoch ms -> the `YYYY-MM-DDTHH:mm` an `<input type="datetime-local">` wants. */
export function toDateTimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * `YYYY-MM-DDTHH:mm` from a datetime-local input -> epoch ms, or null if the
 * string is incomplete (the browser emits "" while the user is still typing).
 * Parsed as local time, which is what the input means.
 */
export function fromDateTimeLocalValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
