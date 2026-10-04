import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Alert — the shared inline notice primitive (cmp-alert).
 *
 * Two variants:
 * - `error` destructive `--destructive` — the form-level auth failure on
 *   sign-in ("That email and password combination is not right").
 * - `info` `--info` blue — defensive 401/403 inline notices.
 *
 * Both are announced: the container defaults to `role="alert"` so assistive
 * tech reads the notice as soon as it mounts. Field-level errors are wired
 * separately, through `aria-describedby` on the `Input`.
 *
 * Every colour below is a T-10 design token; the icon strokes `currentColor`.
 * `title` is omitted from the native props because it is a *visible* lead-in
 * line here, not the browser's hover-tooltip attribute.
 */

export type AlertVariant = "error" | "info";

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  error: "border-l-destructive text-destructive",
  info: "border-l-info text-info",
};

/** Circular notice icon, stroked with the variant's token colour. */
function AlertIcon({ variant }: { variant: AlertVariant }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      className="mt-0.5 h-4 w-4 shrink-0"
    >
      <circle cx="10" cy="10" r="7.5" />
      {variant === "error" ? (
        <>
          <path d="M10 6.25v4.25" />
          <path d="M10 13.6h.01" />
        </>
      ) : (
        <>
          <path d="M10 8.75v4.5" />
          <path d="M10 6.3h.01" />
        </>
      )}
    </svg>
  );
}

/** Props accepted by {@link Alert}. */
export interface AlertProps
  extends Omit<ComponentPropsWithoutRef<"div">, "title"> {
  /** `error` (destructive) or `info` (blue) notice. Defaults to `info`. */
  variant?: AlertVariant;
  /** Bold lead-in line, e.g. "Sign-in failed". Inherits the variant colour. */
  title?: ReactNode;
}

export function Alert({
  variant = "info",
  title,
  role = "alert",
  className,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role={role}
      data-variant={variant}
      className={cn(
        "flex w-full items-start gap-2 rounded-control border border-l-4 border-border bg-card px-3 py-2 shadow-card",
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    >
      <AlertIcon variant={variant} />
      <div className="min-w-0 flex-1">
        {title ? <p className="text-body-s font-semibold">{title}</p> : null}
        {children ? (
          <div className="text-body-s text-foreground">{children}</div>
        ) : null}
      </div>
    </div>
  );
}

export default Alert;
