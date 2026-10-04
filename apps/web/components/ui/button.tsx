import type { ComponentPropsWithRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Button — the shared action primitive (cmp-button).
 *
 * Variants (exactly one primary per screen — the celebration accent is spent
 * once):
 * - `primary`     amber `--primary` fill, white text: "Sign in", "Send kudos".
 * - `secondary`   stone `--secondary` fill: pagination prev/next, sign out.
 * - `ghost`       transparent, muted text: the lead "Hide" trigger, eye toggle.
 * - `destructive` `--destructive` fill — reserved for the hide-confirm action.
 *
 * Every colour, radius, shadow and duration below resolves to a T-10 design
 * token (see `app/globals.css` + `tailwind.config.ts`); nothing is hardcoded.
 *
 * The focus ring is never removed: on top of the global `:focus-visible`
 * outline in `globals.css`, each variant carries `ring-2 ring-ring` with a 2px
 * offset, so the amber ring survives any future base-style change.
 *
 * `loading` renders a spinner and disables interaction (the spinner uses
 * `border-current`, so it inherits the variant's foreground token, and stops
 * spinning under reduced motion).
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const BASE_CLASSES =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap " +
  "rounded-control font-body font-semibold transition duration-fast ease-enter " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-background " +
  "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 " +
  "disabled:shadow-none";

/** Variant fills — filled buttons lift a pixel on hover and settle on press. */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-primary text-primary-foreground shadow-card",
    "hover:shadow-card-hover hover:-translate-y-px",
    "active:translate-y-0 active:shadow-card",
  ),
  secondary: cn(
    "bg-secondary text-secondary-foreground shadow-card",
    "hover:shadow-card-hover hover:-translate-y-px",
    "active:translate-y-0 active:shadow-card",
  ),
  ghost: cn(
    "bg-transparent text-muted-foreground shadow-none",
    "hover:bg-muted hover:text-foreground",
    "active:bg-muted",
  ),
  destructive: cn(
    "bg-destructive text-destructive-foreground shadow-card",
    "hover:shadow-card-hover hover:-translate-y-px",
    "active:translate-y-0 active:shadow-card",
  ),
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-caption",
  md: "px-4 py-2 text-body-s",
  lg: "px-5 py-2.5 font-medium text-body-m",
};

/** Options accepted by {@link buttonVariants}. */
export interface ButtonVariantsOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

/**
 * The full class string for a button look — exported so link-styled actions
 * (`next/link`) can share the exact same visuals without duplicating tokens.
 */
export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: ButtonVariantsOptions = {}): string {
  return cn(
    BASE_CLASSES,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  );
}

/** Props accepted by {@link Button}. */
export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  /** Visual variant; defaults to `primary`. */
  variant?: ButtonVariant;
  /** Control size; defaults to `md`. */
  size?: ButtonSize;
  /**
   * Submitting state: renders a spinner before the label, sets `aria-busy` and
   * disables the control so the action cannot be double-fired.
   */
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled === true || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-size={size}
      data-loading={loading ? "true" : undefined}
      data-disabled={isDisabled ? "true" : undefined}
      className={cn(
        buttonVariants({ variant, size }),
        loading && "cursor-wait",
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          data-testid="button-spinner"
          className="inline-block h-3.5 w-3.5 animate-spin rounded-pill border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </button>
  );
}

export default Button;
