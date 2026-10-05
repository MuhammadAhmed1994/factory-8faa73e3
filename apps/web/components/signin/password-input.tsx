"use client";

import { useId, useState } from "react";
import type { ComponentPropsWithRef } from "react";

import Input from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * PasswordInput — the shared password field (cmp-input-password) wrapping the
 * shared {@link Input} primitive.
 *
 * Adds exactly one thing on top of it: a ghost eye-icon toggle that flips the
 * input between `type="password"` (concealed) and `type="text"` (revealed).
 *
 * Accessibility contract (from the screen's `accessibility` notes):
 * - The toggle is a real labelled button, never a bare icon: it carries
 *   `aria-label="Show password"` while concealed and `"Hide password"` once
 *   revealed, plus `aria-pressed` so the revealed state is conveyed as a
 *   pressed toggle rather than a pair of mystery icons.
 * - The icon itself is `aria-hidden` — the words carry the meaning.
 * - The amber focus ring from `Input`/`globals.css` is inherited as-is; the
 *   toggle carries its own `focus-visible` ring so it is never removed.
 * - Revealing never submits the form: the toggle is `type="button"`.
 *
 * Every native attribute (`id`, `aria-describedby`, `autoComplete`,
 * `disabled`, `onBlur`, …) is forwarded verbatim to the inner `Input`, so the
 * field-level caption wiring behaves identically to a plain input.
 */

/** Props accepted by {@link PasswordInput}. */
export interface PasswordInputProps
  extends Omit<ComponentPropsWithRef<"input">, "type"> {
  /**
   * Initial reveal state. Uncontrolled on purpose: the member's reveal choice
   * is throwaway UI state and resetting it on a parent re-render would hide a
   * password they had deliberately chosen to check.
   */
  defaultRevealed?: boolean;
  /** Extra classes for the wrapping control. */
  containerClassName?: string;
}

/** Ghost eye icon, concealed (slashed) state. */
function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 19.876 0a1 1 0 0 1 0 .696a10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Ghost eye icon, revealed (open) state. */
function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M13.66 13.66a3 3 0 0 1-4.24-4.24" />
      <path d="M10.27 5.63A10.86 10.86 0 0 1 12 5.5c4.5 0 8.24 3.36 9.94 6.31a1 1 0 0 1 0 .99c-.34.6-.76 1.22-1.25 1.82" />
      <path d="M6.53 6.79C4.24 8.15 2.66 10.19 2.06 11.81a1 1 0 0 0 0 .38a10.75 10.75 0 0 0 5.94 5.94" />
      <path d="M14.21 14.21a3 3 0 0 1-2.9 1.94a3 3 0 0 1-2.9-1.94" />
      <path d="M3.5 3.5l17 17" />
    </svg>
  );
}

export function PasswordInput({
  id,
  defaultRevealed = false,
  containerClassName,
  className,
  ...props
}: PasswordInputProps) {
  // `useId` defaults to ids containing `:`, which are not valid in an `id`
  // attribute; strip them so the toggle's wiring stays resolvable.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const inputId = id ?? `password-${uid}`;
  const toggleId = `${inputId}-reveal`;

  const [revealed, setRevealed] = useState(defaultRevealed);

  return (
    <span
      data-component="password-input"
      data-revealed={revealed ? "true" : "false"}
      className={cn(
        "relative block w-full align-bottom",
        containerClassName,
      )}
    >
      <Input
        id={inputId}
        type={revealed ? "text" : "password"}
        className={cn("pr-11", className)}
        {...props}
      />
      <button
        id={toggleId}
        type="button"
        onClick={() => setRevealed((current) => !current)}
        aria-label={revealed ? "Hide password" : "Show password"}
        aria-pressed={revealed}
        data-state={revealed ? "revealed" : "concealed"}
        disabled={props.disabled}
        className={cn(
          "absolute right-1.5 top-1/2 -translate-y-1/2",
          "flex h-8 w-8 items-center justify-center rounded-sm",
          "bg-transparent text-muted-foreground",
          "transition duration-fast ease-enter",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60",
          "motion-reduce:transition-none",
        )}
      >
        {revealed ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  );
}

export default PasswordInput;
