"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn, FOCUS_RING } from "./cn";

/**
 * Button (`cmp-button`) — the shared action primitive.
 *
 * Four variants, each styled purely with the design tokens from
 * `app/globals.css` / `tailwind.config.ts` (never a hardcoded hex):
 *
 * - `primary`   amber `--primary`, white text — spent once per screen on the
 *               moment of giving thanks (`Sign in`, `Send kudos`).
 * - `secondary` neutral `--secondary`, white text — pagination prev/next, sign
 *               out, and the lead `Hide` control.
 * - `ghost`     chromeless — quiet, low-contrast actions; moderation stays quiet
 *               by design.
 * - `destructive` `--destructive`, reserved exclusively for the hide-confirm
 *               action. Never celebratory.
 *
 * Every interactive state is designed: default, hover, active, focus-visible,
 * disabled and loading. Loading renders a spinner and disables the control, so a
 * pending action cannot be re-fired. The focus ring is always visible and never
 * removed.
 */

/** Visual variants of {@link Button}. */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive";

/** Size presets of {@link Button}. */
export type ButtonSize = "sm" | "md" | "lg" | "icon";

/**
 * Props for {@link Button}.
 *
 * `type` and `disabled` are inherited from `ButtonHTMLAttributes`; `type`
 * defaults to `"button"` below so a stray `<Button>` inside a form never
 * submits on its own.
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Defaults to `primary`. */
  readonly variant?: ButtonVariant;
  /** Defaults to `md`. */
  readonly size?: ButtonSize;
  /**
   * Renders the spinner and disables the control. Interaction is blocked by the
   * native `disabled` attribute, so the pending action cannot be re-fired.
   */
  readonly loading?: boolean;
  /**
   * Visually-hidden text announced while `loading`, e.g. `Sending kudos`.
   * Defaults to `Loading`.
   */
  readonly loadingText?: string;
}

/** Variant classes. Hover/active shift luminance rather than hue. */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-card hover:brightness-110 active:brightness-95",
  secondary:
    "bg-secondary text-secondary-foreground shadow-card hover:brightness-110 active:brightness-95",
  ghost:
    "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted",
  destructive:
    "bg-destructive text-destructive-foreground shadow-card hover:brightness-110 active:brightness-95",
};

/** Size classes — control radius and the `body_s` button type from the scale. */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3",
  md: "h-10 gap-2 px-4",
  lg: "h-11 gap-2 px-6",
  icon: "h-8 w-8",
};

/**
 * The loading spinner.
 *
 * An inline SVG rather than an icon-library dependency: it inherits
 * `currentColor` and stays decorative (`aria-hidden`), because the pending state
 * is already conveyed by `aria-busy` plus the visually-hidden `loadingText`.
 */
function Spinner() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      className="h-4 w-4 animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The shared button.
 *
 * A Client Component only because it forwards refs and accepts handler props; it
 * renders identically on the server.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading = false,
      loadingText = "Loading",
      disabled = false,
      type = "button",
      className,
      children,
      ...props
    },
    ref,
  ) {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        data-loading={loading ? "true" : undefined}
        data-variant={variant}
        className={cn(
          "inline-flex select-none items-center justify-center whitespace-nowrap rounded-control text-body-s font-medium",
          "transition duration-base ease-enter",
          FOCUS_RING,
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          "disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {loading ? <Spinner /> : null}
        {loading && loadingText ? (
          <span className="sr-only">{loadingText}</span>
        ) : null}
        {children}
      </button>
    );
  },
);

export default Button;
