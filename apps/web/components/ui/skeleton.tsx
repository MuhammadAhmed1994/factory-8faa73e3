import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Skeleton — the muted placeholder block (cmp-skeleton).
 *
 * A `--muted` rounded block that pulses while data loads. The board renders
 * eight of these (one per expected card) for the first page load so the layout
 * holds its shape before the server-rendered kudos arrive; callers size them
 * through `className` (`h-4 w-2/3`, `h-24 w-full`, …).
 *
 * Accessibility: purely decorative (`aria-hidden` by default) and *static*
 * under `prefers-reduced-motion` via `motion-reduce:animate-none`, per the
 * design system's reduced-motion rule.
 */

/** Props accepted by {@link Skeleton} — a plain `div`; size it with `className`. */
export type SkeletonProps = ComponentPropsWithoutRef<"div">;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton"
      className={cn(
        "block animate-pulse rounded-card bg-muted motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export default Skeleton;
