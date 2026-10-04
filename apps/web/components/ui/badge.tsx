import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Badge — the shared overline label primitive (cmp-badge).
 *
 * Variants:
 * - `role`   soft amber pill for the `Lead` role next to the signed-in email.
 * - `hidden` low-contrast stone pill for the `Hidden` marker on hidden kudos —
 *            moderation is quiet, never celebratory.
 * - `count`  numeric pill (tabular figures) for counts.
 *
 * All three render in the overline type token (`.type-overline`: 11px Inter,
 * 600 weight, 0.08em tracking, uppercase) declared in `app/globals.css`.
 */

export type BadgeVariant = "role" | "hidden" | "count";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  role: "border-accent-soft bg-accent-soft text-foreground",
  hidden: "border-border bg-muted text-muted-foreground",
  count: "border-border bg-card text-muted-foreground tabular-nums",
};

/** Props accepted by {@link Badge}. */
export interface BadgeProps extends ComponentPropsWithoutRef<"span"> {
  /** Which badge look to render; defaults to `role`. */
  variant?: BadgeVariant;
}

export function Badge({ variant = "role", className, ...props }: BadgeProps) {
  return (
    <span
      data-variant={variant}
      className={cn(
        "type-overline inline-flex items-center gap-1 whitespace-nowrap rounded-pill border px-2 py-0.5",
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  );
}

export default Badge;
