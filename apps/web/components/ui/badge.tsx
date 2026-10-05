/**
 * Badge (`cmp-badge`) — a tiny overline label.
 *
 * Three variants, all in the `overline` type from the design scale (11px
 * uppercase, 0.08em tracking) for labels like `Lead` and `Hidden`:
 *
 * - `role`   neutral, bordered — `Lead` beside the signed-in email.
 * - `hidden` muted, quiet — the `Hidden` tag on a hidden kudos card. Moderation
 *           is quiet and never celebratory.
 * - `count`  amber-tinted pill — the reaction count on a chip.
 *
 * This is a label, not a status dot and not a notification bell: notifications
 * are out of scope, and toasts exist only for action feedback.
 */

import type { ReactNode } from "react";
import { cn } from "./cn";

/** Visual variants of {@link Badge}. */
export type BadgeVariant = "role" | "hidden" | "count";

/** Props for {@link Badge}. */
export interface BadgeProps {
  /** Defaults to `role`. */
  readonly variant?: BadgeVariant;
  /** The label, already uppercase via the `overline` type token. */
  readonly children: ReactNode;
  /** Landmark-free: pass an id only when a test or caption needs to target it. */
  readonly id?: string;
  /** Extra class names appended after the primitive's own. */
  readonly className?: string;
}

/** Variant classes. */
const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  role: "border-border bg-card text-muted-foreground",
  hidden: "border-border bg-muted text-muted-foreground",
  count: "border-primary/30 bg-accent-soft text-primary",
};

/**
 * The shared badge.
 *
 * A Server Component: purely presentational.
 */
export function Badge({
  variant = "role",
  children,
  id,
  className,
}: BadgeProps) {
  return (
    <span
      id={id}
      data-variant={variant}
      className={cn(
        "inline-flex items-center rounded-pill border px-2 py-0.5 font-sans uppercase text-overline leading-none",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export default Badge;
