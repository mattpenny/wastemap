"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A truncated name that scrolls (marquee) on hover to reveal the full text.
 *
 * Used in the ranking cards where long English facility names ("West New
 * Territories Landfill (WENT)") would otherwise be clipped. At rest it behaves
 * like `truncate` (start shown, overflow hidden); on hover, if the text is
 * wider than its box, it scrolls left so the tail becomes readable, then loops.
 */
export default function ScrollingName({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const [overflow, setOverflow] = React.useState(false);
  const [hover, setHover] = React.useState(false);

  // Measure whether the text actually overflows its box. Re-measure on resize and
  // whenever the text changes (e.g. language switch).
  React.useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      setOverflow(el.scrollWidth - el.clientWidth > 1);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text]);

  const dist =
    ref.current && overflow ? ref.current.scrollWidth - ref.current.clientWidth : 0;
  // Scroll speed scales with how much is hidden; clamp to a readable range.
  const duration = Math.min(12, Math.max(4, dist / 18));

  return (
    <span
      className={cn("relative block min-w-0 flex-1 overflow-hidden", className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={overflow ? text : undefined}
    >
      <span
        ref={ref}
        className={cn("block whitespace-nowrap", hover && overflow && "animate-marquee")}
        style={
          hover && overflow
            ? ({
                ["--marquee-dist" as string]: `${-dist}px`,
                animationDuration: `${duration}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </span>
  );
}
