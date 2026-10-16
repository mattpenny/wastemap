"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A facility card's name: the short label at rest, the full name on hover.
 *
 * Hovering slides the short label out to the right while the full name comes
 * in from the left, so the two swap in one left-to-right motion. Both occupy
 * the same box, so the row never changes height and the throughput figure
 * beside it never moves.
 *
 * The full name is often wider than the card — "North West New Territories
 * Transfer Station (NWNTTS)" is roughly 360px against a 250px column — so it
 * keeps travelling until its tail is visible, and the transition is given a
 * duration proportional to the distance. Truncating instead would have meant
 * revealing a long name only to cut it off, which is the problem the short
 * label already solves.
 *
 * The parent row must carry `group/row`.
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
  const boxRef = React.useRef<HTMLSpanElement | null>(null);
  const textRef = React.useRef<HTMLSpanElement | null>(null);
  const [travel, setTravel] = React.useState(0);

  React.useEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;

    // Measured rather than guessed: the width depends on the label, the UI
    // language and the A− / A+ font scale, all of which can change at runtime.
    const measure = () =>
      setTravel(Math.max(0, Math.round(text.scrollWidth - box.clientWidth)));

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    observer.observe(box);
    return () => observer.disconnect();
  }, [full]);

  return (
    <span ref={boxRef} className={cn("relative block min-w-0 overflow-hidden", className)}>
      {/* Short label — slides out to the right. */}
      <span className="block truncate transition-transform duration-300 ease-out group-hover/row:translate-x-full">
        {short}
      </span>
      {/* Full name — slides in from the left, then keeps going if it is long. */}
      <span
        ref={textRef}
        aria-hidden="true"
        style={{
          // Distance the full name has to travel to show its tail.
          ["--reveal" as string]: `${-travel}px`,
          transitionDuration: `${Math.max(320, Math.min(1600, 320 + travel * 4))}ms`,
        }}
        className="pointer-events-none absolute inset-y-0 left-0 whitespace-nowrap text-white/95 transition-transform ease-out -translate-x-full group-hover/row:translate-x-[var(--reveal)]"
      >
        {full}
      </span>
    </span>
  );
}
