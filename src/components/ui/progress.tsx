"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0–100. Values outside the range are clamped. */
  value: number;
  /** Any CSS colour — used to match the utilisation ramp. */
  indicatorColor?: string;
  /** Draw subtle tick marks at 25/50/75% to aid reading the value. */
  showTicks?: boolean;
}

/**
 * Progress bar. Deliberately not Radix-based: the fill colour is driven by the
 * utilisation ramp at runtime, so a plain element with an inline style is both
 * simpler and cheaper than threading a CSS variable through a primitive.
 */
export function Progress({
  value,
  indicatorColor = "#10b981",
  showTicks = false,
  className,
  ...props
}: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "relative h-3 w-full overflow-hidden rounded-full bg-white/10 ring-1 ring-inset ring-white/5",
        className
      )}
      {...props}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{
          width: `${clamped}%`,
          background: `linear-gradient(90deg, ${indicatorColor}bb, ${indicatorColor})`,
          boxShadow: `0 0 12px ${indicatorColor}80`,
        }}
      />
      {showTicks && (
        <div className="pointer-events-none absolute inset-0 flex justify-between px-[25%]">
          <span className="h-full w-px bg-slate-950/25" />
          <span className="h-full w-px bg-slate-950/25" />
        </div>
      )}
    </div>
  );
}
