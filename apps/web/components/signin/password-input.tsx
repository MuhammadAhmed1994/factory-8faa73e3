"use client";

/**
 * PasswordInput (`cmp-input-password`) — the shared `Input` plus a ghost
 * eye-icon reveal toggle.
 *
 * The toggle flips the underlying input between `type="password"` and
 * `type="text"` and exposes its state through `aria-pressed` with an
 * `aria-label` of `Show password` / `Hide password`, so it is a labelled icon
 * button rather than a bare glyph (a11y requirement). It is `type="button"` so
 * revealing never submits the surrounding sign-in form, and it is disabled
 * together with the field so the two can never disagree.
 *
 * The icon itself is an inline SVG in the lucide idiom (the icon library named
 * by the design system) — no third-party dependency is added for two glyphs.
 *
 * Ids, `aria-describedby` and the `error` state are forwarded rather than
 * owned, exactly like the shared `Input`, so the caller's `<label htmlFor>`
 * stays the single source of the field's accessible name.
 */

import { forwardRef, useState } from "react";
import { Input, type InputProps } from "../ui/input";
import { cn, FOCUS_RING } from "../ui/cn";

/** Props for {@link PasswordInput}: everything `cmp-input` accepts. */
export interface PasswordInputProps extends InputProps {}

/** Lucide `eye` — the masked state. Decorative: the label carries the meaning. */
function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4"
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 19.876 0a1 1 0 0 1 0 .696a10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Lucide `eye-off` — the revealed state. */
function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

/**
 * A password field with a reveal toggle.
 *
 * A Client Component because the toggle owns local state; every other prop is
 * forwarded straight to the shared {@link Input}, whose `error` / `disabled`
 * states and `aria-describedby` wiring keep working unchanged.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, disabled, ...props }, ref) {
    const [revealed, setRevealed] = useState(false);

    return (
      <div className="relative w-full">
        <Input
          ref={ref}
          disabled={disabled}
          {...props}
          type={revealed ? "text" : "password"}
          className={cn("pr-11", className)}
        />

        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          disabled={disabled}
          aria-pressed={revealed}
          aria-label={revealed ? "Hide password" : "Show password"}
          title={revealed ? "Hide password" : "Show password"}
          data-revealed={revealed ? "true" : "false"}
          className={cn(
            "absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center",
            "rounded-sm bg-transparent text-muted-foreground",
            "transition duration-base ease-enter hover:text-foreground",
            FOCUS_RING,
            "disabled:pointer-events-none disabled:opacity-55",
          )}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    );
  },
);

export default PasswordInput;
