"use client";

/**
 * Toaster (`cmp-toast`) — action feedback only.
 *
 * The design calls for sonner, which is not installed in this workspace, and no
 * dependency may be added without regenerating `pnpm-lock.yaml`. So this module
 * implements the same surface sonner exposes — `toast()`, `toast.success()`,
 * `toast.error()`, `toast.dismiss()`, `toast.promise()` and `<Toaster />` — with
 * no third-party import. Callers keep importing from
 * `@/components/ui/toaster`, so adopting the real library later is a change
 * confined to this one file.
 *
 * Toasts exist strictly for action feedback ("Kudos sent", reaction
 * saved/failed, kudos hidden / hide failed). They are not notifications, which
 * are explicitly out of scope — so no badges, no bells, no unread counts.
 *
 * Styling is 100% token-driven: success uses `--success`, error uses
 * `--destructive`, the surface is `--card` with the popover elevation. No hex
 * values live here.
 */

import { useEffect, useSyncExternalStore } from "react";
import { cn, FOCUS_RING } from "./cn";

/** Where the toast stack sits on screen. */
export type ToastPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

/** Severity of a toast; drives colour and icon. */
export type ToastVariant = "success" | "error" | "info";

/** A single toast in the store. */
export interface ToastItem {
  readonly id: number;
  readonly title: string;
  readonly description?: string;
  readonly variant: ToastVariant;
  /** Unix ms after which the toast removes itself, or `Infinity` to persist. */
  readonly dismissAt: number;
}

/** Options accepted by {@link toast} and its helpers. */
export interface ToastOptions {
  /** Secondary line under the title. */
  readonly description?: string;
  /** Override the variant; each helper has its own default. */
  readonly variant?: ToastVariant;
  /** Milliseconds before auto-dismiss. Pass `Infinity` to keep it until dismissed. */
  readonly duration?: number;
}

/** The Promise-facing strings {@link toast.promise} needs. */
export interface ToastPromiseMessages {
  readonly loading: string;
  readonly success: string;
  readonly error: string;
}

/**
 * Default auto-dismiss: long enough to read one short line, short enough not to
 * linger over the board.
 */
const DEFAULT_DURATION = 4000;

/** Empty stack snapshot, shared so `getServerSnapshot` stays referentially stable. */
const EMPTY_TOASTS: readonly ToastItem[] = [];

/** Monotonic id source; starts at 1 so an id is always truthy. */
let nextId = 1;

/** Live toast list. Module-scoped so any client island can publish without prop drilling. */
let toasts: readonly ToastItem[] = EMPTY_TOASTS;

/** Registered listeners of the store above. */
const listeners = new Set<() => void>();

/** Notifies every subscriber that the store changed. */
function emit(): void {
  for (const listener of listeners) listener();
}

/** Subscribes to toast changes; returns an unsubscribe function. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Client snapshot for `useSyncExternalStore`; must be referentially stable. */
function getSnapshot(): readonly ToastItem[] {
  return toasts;
}

/** Server snapshot: no toast exists during SSR, so hydration always matches. */
function getServerSnapshot(): readonly ToastItem[] {
  return EMPTY_TOASTS;
}

/** Publishes a toast and returns its id. */
function publish(title: string, options: ToastOptions = {}): number {
  const id = nextId;
  nextId += 1;
  const duration = options.duration ?? DEFAULT_DURATION;

  toasts = [
    ...toasts,
    {
      id,
      title,
      ...(options.description !== undefined
        ? { description: options.description }
        : {}),
      variant: options.variant ?? "info",
      dismissAt: Number.isFinite(duration)
        ? Date.now() + duration
        : Number.POSITIVE_INFINITY,
    },
  ];
  emit();
  return id;
}

/** Replaces the toast with `id`, keeping its slot in the stack. */
function patch(id: number, title: string, options: ToastOptions = {}): void {
  const duration = options.duration ?? DEFAULT_DURATION;

  toasts = toasts.map((item) => {
    if (item.id !== id) return item;
    return {
      id,
      title,
      description:
        options.description !== undefined
          ? options.description
          : item.description,
      variant: options.variant ?? item.variant,
      dismissAt: Number.isFinite(duration)
        ? Date.now() + duration
        : Number.POSITIVE_INFINITY,
    };
  });
  emit();
}

/** Removes every toast whose `dismissAt` has passed. */
function dismissExpired(): void {
  const now = Date.now();
  const survivors = toasts.filter((item) => item.dismissAt > now);
  if (survivors.length === toasts.length) return;
  toasts = survivors;
  emit();
}

/**
 * Removes a toast. With no `id`, clears the whole stack — mirroring sonner.
 */
export function toastDismiss(id?: number): void {
  toasts =
    id === undefined ? EMPTY_TOASTS : toasts.filter((item) => item.id !== id);
  emit();
}

/** The `toast` function, with the helpers sonner also attaches. */
export interface ToastFn {
  /** Publishes a toast, defaulting to the `info` variant. */
  (message: string, options?: ToastOptions): number;
  /** Feedback for a completed action — "Kudos sent". */
  success(message: string, options?: ToastOptions): number;
  /** Feedback for a failed action — "Could not save reaction". */
  error(message: string, options?: ToastOptions): number;
  /** Neutral feedback. */
  info(message: string, options?: ToastOptions): number;
  /** Removes one toast, or all of them. */
  dismiss(id?: number): void;
  /** Mirrors a promise through loading → success/error. */
  promise<T>(promise: Promise<T>, messages: ToastPromiseMessages): Promise<T>;
}

/**
 * Publishes a toast.
 *
 * Kept as a plain function (not a hook) so any client island — composer,
 * reaction picker, hide control — can surface action feedback without threading
 * context or lifting state.
 */
export const toast: ToastFn = Object.assign(
  (message: string, options?: ToastOptions) => publish(message, options),
  {
    success: (message: string, options?: ToastOptions) =>
      publish(message, { ...options, variant: "success" }),
    error: (message: string, options?: ToastOptions) =>
      publish(message, { ...options, variant: "error" }),
    info: (message: string, options?: ToastOptions) =>
      publish(message, { ...options, variant: "info" }),
    dismiss: toastDismiss,
    promise: <T,>(promise: Promise<T>, messages: ToastPromiseMessages) => {
      const id = publish(messages.loading, {
        variant: "info",
        duration: Number.POSITIVE_INFINITY,
      });

      return promise.then(
        (value: T) => {
          patch(id, messages.success, { variant: "success" });
          return value;
        },
        (error: unknown) => {
          patch(id, messages.error, { variant: "error" });
          throw error;
        },
      );
    },
  },
);

/** Position → utility classes for the fixed stack. */
const POSITION_CLASSES: Record<ToastPosition, string> = {
  "top-left": "top-0 left-0",
  "top-center": "top-0 left-1/2 -translate-x-1/2",
  "top-right": "top-0 right-0",
  "bottom-left": "bottom-0 left-0",
  "bottom-center": "bottom-0 left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-0 right-0",
};

/** Variant → accent class for the glyph (text colour only, never a fill). */
const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: "text-success",
  error: "text-destructive",
  info: "text-info",
};

/** Props shared by the inline severity glyphs. */
const GLYPH_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false as const,
};

/**
 * Decorative severity glyph.
 *
 * An inline SVG rather than an icon-library dependency. It is `aria-hidden`
 * because the toast text carries the meaning on its own — the icon is never the
 * sole carrier of meaning (a11y requirement).
 */
function ToastIcon({ variant }: { readonly variant: ToastVariant }) {
  if (variant === "success") {
    return (
      <svg {...GLYPH_PROPS} className="h-4 w-4">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }

  if (variant === "error") {
    return (
      <svg {...GLYPH_PROPS} className="h-4 w-4">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    );
  }

  return (
    <svg {...GLYPH_PROPS} className="h-4 w-4">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

/** Props for {@link Toaster}. */
export interface ToasterProps {
  /** Defaults to `bottom-right`, clear of the composer and the pagination nav. */
  readonly position?: ToastPosition;
  /** Extra class names for the fixed region. */
  readonly className?: string;
}

/**
 * The toast viewport.
 *
 * Mount once, high in the tree (the root layout is the natural home). It is a
 * Client Component because it owns live state and timers; nothing else has to be
 * client-side to publish a toast.
 *
 * The region is `aria-live="polite"` with `aria-relevant="additions text"` so a
 * new toast is announced once without re-announcing the rest of the stack, and
 * it never steals focus.
 */
export function Toaster({ position = "bottom-right", className }: ToasterProps) {
  const items = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  /** Soonest finite expiry drives the single auto-dismiss timer. */
  const soonest = items.reduce<number | null>(
    (earliest, item) =>
      Number.isFinite(item.dismissAt)
        ? earliest === null
          ? item.dismissAt
          : Math.min(earliest, item.dismissAt)
        : earliest,
    null,
  );

  useEffect(() => {
    if (soonest === null) return;

    const remaining = soonest - Date.now();
    if (remaining <= 0) {
      dismissExpired();
      return;
    }

    const timer = window.setTimeout(dismissExpired, remaining);
    return () => window.clearTimeout(timer);
  }, [soonest]);

  return (
    <ol
      aria-live="polite"
      aria-relevant="additions text"
      className={cn(
        "pointer-events-none fixed z-50 flex w-full max-w-sm flex-col gap-2 p-4",
        POSITION_CLASSES[position],
        className,
      )}
    >
      {items.map((item) => (
        <li
          key={item.id}
          data-variant={item.variant}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-card border border-border bg-card px-3 py-2 shadow-popover",
            VARIANT_CLASSES[item.variant],
          )}
        >
          <ToastIcon variant={item.variant} />

          <div className="min-w-0 flex-1 text-foreground">
            <p className="text-body-s font-medium">{item.title}</p>
            {item.description ? (
              <p className="mt-0.5 text-caption text-muted-foreground">
                {item.description}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => toastDismiss(item.id)}
            className={cn(
              "rounded-control p-1 text-muted-foreground transition duration-base ease-enter hover:bg-muted hover:text-foreground",
              FOCUS_RING,
            )}
          >
            <span className="sr-only">Dismiss notification</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
              className="h-3.5 w-3.5"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </li>
      ))}
    </ol>
  );
}

export default Toaster;
