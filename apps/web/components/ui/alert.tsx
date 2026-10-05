/**
 * Alert (`cmp-alert`) — an inline notice, not a modal and not a notification.
 *
 * Two variants, both token-driven:
 *
 * - `error` destructive tint — form-level auth failure on the sign-in card,
 *   field-level problems the caller surfaces inline.
 * - `info`  `--info` blue — defensive 401/403 notices where no field is at
 *   fault.
 *
 * Rendered with `role="alert"` so its content is announced assertively the
 * moment it appears (a11y requirement: "error summary on sign-in announced via
 * role=alert").
 */

import type { ReactNode } from "react";
import { cn } from "./cn";

/** Visual variants of {@link Alert}. */
export type AlertVariant = "error" | "info";

/** Props for {@link Alert}. */
export interface AlertProps {
  /** Defaults to `info`. */
  readonly variant?: AlertVariant;
  /** The notice text. Keep it one short line — this is a quiet component. */
  readonly children: ReactNode;
  /** Optional id, e.g. to reference from a field's `aria-describedby`. */
  readonly id?: string;
  /** Extra class names appended after the primitive's own. */
  readonly className?: string;
}

/** Variant classes: a soft tinted surface, never a saturated block of colour. */
const VARIANT_CLASSES: Record<AlertVariant, string> = {
  error:
    "border-destructive/30 bg-destructive/5 text-destructive [&_svg]:text-destructive",
  info: "border-info/30 bg-info/5 text-info [&_svg]:text-info",
};

/**
 * The shared inline alert.
 *
 * A Server Component: it has no state, no effects and no handlers.
 */
export function Alert({
  variant = "info",
  children,
  id,
  className,
}: AlertProps) {
  return (
    <div
      id={id}
      role="alert"
      data-variant={variant}
      className={cn(
        "flex items-start gap-2 rounded-control border px-3 py-2 text-caption",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </div>
  );
}

export default Alert;
