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
