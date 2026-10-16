import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[length:calc(11px*var(--fs))] font-semibold uppercase tracking-wide ring-1 ring-inset transition-colors",
  {
    variants: {
      variant: {
        default: "bg-white/10 text-white/80 ring-white/15",
        outline: "bg-transparent text-white/70 ring-white/20",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Extra classes used to override the colour for a specific category. */
  tone?: string;
}

export function Badge({ className, variant, tone, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant }), tone, className)}
      {...props}
    />
  );
}

export { badgeVariants };
