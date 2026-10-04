import type { ComponentPropsWithRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Input — the shared text-field primitive (cmp-input) used for the sign-in
 * email/password fields and the composer's recipient name.
 *
 * States:
 * - `default`  muted `--muted` fill on the `--border` border.
 * - `focus`    `--primary` border plus the always-visible amber focus ring.
 * - `error`    `invalid` sets `aria-invalid="true"` and switches the border and
 *              focus ring to `--destructive`.
 * - `disabled` native `disabled`, dimmed and non-interactive.
 *
 * Field captions: every native attribute — including `id` and
 * `aria-describedby` — is forwarded verbatim, so a caption rendered next to the
 * field can be wired up by giving it the id passed in `aria-describedby`:
 *
 * ```tsx
 * <Input id="recipient" invalid aria-describedby="recipient-error" />
 * <p id="recipient-error">Who is this kudos for?</p>
 * ```
 */

const BASE_CLASSES = cn(
  "w-full rounded-control border border-border bg-muted px-3 py-2",
  "font-body text-body-s text-foreground",
  "transition duration-fast ease-enter",
  "placeholder:text-muted-foreground",
  "focus:border-primary focus-visible:border-primary",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "focus-visible:ring-offset-background",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

/** Applied on top of the base classes when `invalid` is true. */
const INVALID_CLASSES = cn(
  "border-destructive bg-card",
  "focus:border-destructive focus-visible:border-destructive",
  "focus-visible:ring-destructive",
  "placeholder:text-destructive",
);

/** Props accepted by {@link Input}. */
export interface InputProps extends ComponentPropsWithRef<"input"> {
  /**
   * Error state: sets `aria-invalid` (and `data-invalid`) so screen readers
   * announce the field as invalid, and colours the border/ring with the
   * destructive token.
   */
  invalid?: boolean;
}

export function Input({ invalid = false, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      data-invalid={invalid ? "true" : undefined}
      className={cn(BASE_CLASSES, invalid && INVALID_CLASSES, className)}
      {...props}
    />
  );
}

export default Input;
