"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A facility card's name: the short label at rest, the full name on hover.
 *
 * The reveal layer covers the *whole row*, not just the short label's box, so
 * the full name travels across the entire card width rather than stopping at
 * the abbreviation. Both parts are absolutely placed against the row, so the
 * parent button must be `relative` and carry `group/row`.
 *
 * A full name like "North West New Territories Transfer Station (NWNTTS)" is
 * roughly 360px against a 250px card, so it keeps travelling until its tail is
 * visible, with the transition duration scaled to the distance. Truncating
 * instead would reveal a long name only to cut it off — the problem the short
 * label already solves.
 */
export default function ShortName({
  short,
  full,
  className,
}: {
  short: string;
  full: string;
  className?: string;
}) {
  const rowRef = React.useRef<HTMLSpanElement | null>(null);
  const textRef = React.useRef<HTMLSpanElement | null>(null);
  const [travel, setTravel] = React.useState(0);

  React.useEffect(() => {
    const row = rowRef.current;
    const text = textRef.current;
    if (!row || !text) return;

    // Measured rather than guessed: the width depends on the label, the UI
    // language and the A− / A+ font scale, all of which change at runtime.
    const measure = () =>
      setTravel(Math.max(0, Math.round(text.scrollWidth - row.clientWidth)));

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    observer.observe(row);
    return () => observer.disconnect();
  }, [full]);

  return (
    <span className="contents">
      {/* Short label, in flow — it gives the row its height and keeps the
          throughput figure where it belongs. */}
      <span
        className={cn(
          "truncate transition-opacity duration-200 group-hover/row:opacity-0",
          className
        )}
      >
        {short}
      </span>

      {/* Full name, overlaid across the whole row. */}
      <span
        ref={rowRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 flex w-full items-center overflow-hidden"
      >
        <span
          ref={textRef}
          style={{
            // Distance the full name has to travel to show its tail.
            ["--reveal" as string]: `${-travel}px`,
            transitionDuration: `${Math.max(320, Math.min(1800, 320 + travel * 4))}ms`,
          }}
          className="whitespace-nowrap text-white/95 transition-transform ease-out -translate-x-full group-hover/row:translate-x-[var(--reveal)]"
        >
          {full}
        </span>
      </span>
    </span>
  );
}
