"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Toaster — the app's action-feedback surface (cmp-toast).
 *
 * ⚠️ Why this is not a re-export of `sonner` (yet)
 * ------------------------------------------------
 * The UX spec calls for `sonner`'s `<Toaster />`. That package is **not**
 * provisioned anywhere in this workspace: it is absent from `pnpm-lock.yaml`
 * and from every `node_modules` tree, and `apps/web/package.json` cannot gain a
 * dependency in this task (adding one without regenerating the lockfile breaks
 * every package's install with `ERR_PNPM_OUTDATED_LOCKFILE`).
 *
 * This module therefore implements the exact subset of sonner's public API the
 * product needs, with the identical call-site shape:
 *
 * ```tsx
 * import { toast } from "@/components/ui/toaster";
 * toast.success("Kudos sent");
 * toast.error("Reaction could not be saved");
 * ```
 *
 * so swapping the internals for `export { Toaster, toast } from "sonner"` later
 * is a one-line change that touches no caller.
 *
 * Design rules honoured here:
 * - Success state/icon uses the `--success` token, errors the `--destructive`
 *   one — no hardcoded hex anywhere.
 * - Toasts are **action feedback only** ("Kudos sent", reaction saved/failed,
 *   kudos hidden). Notifications are out of scope for this product, so there is
 *   no badge, bell or unread counter anywhere in this file.
 * - Announced politely; error toasts are `role="alert"` so they are read out
 *   assertively, everything else `role="status"`.
 * - Reduced motion: entrance is an opacity-only transition
 *   (`motion-reduce:transition-none`), spinners stop under `motion-reduce:`.
 */

export type ToastVariant = "default" | "success" | "error" | "info" | "loading";

/** One rendered toast. */
export interface ToastItem {
  id: number;
  title: ReactNode;
  description?: ReactNode;
  variant: ToastVariant;
  /** Auto-dismiss delay in ms; `Infinity` keeps the toast until dismissed. */
  duration: number;
}

/** Options accepted by every `toast*` helper. */
export interface ToastOptions {
  /** Secondary line under the title. */
  description?: ReactNode;
  /** Override the auto-dismiss delay. */
  duration?: number;
  /** Re-use an existing toast's slot (updates it in place) instead of adding. */
  id?: number;
}

type ToastListener = () => void;

/**
 * Module-level store, kept outside React so `toast.success(...)` works from any
 * client event handler or effect without a provider — exactly like sonner's.
 * The array reference only changes when the set of toasts changes, which makes
 * it a valid `useSyncExternalStore` snapshot.
 */
const EMPTY_TOASTS: ToastItem[] = [];
const state: {
  toasts: ToastItem[];
  listeners: Set<ToastListener>;
  nextId: number;
} = {
  toasts: EMPTY_TOASTS,
  listeners: new Set(),
  nextId: 1,
};

function emit(): void {
  for (const listener of state.listeners) {
    listener();
  }
}

function setToasts(next: ToastItem[]): void {
  state.toasts = next;
  emit();
}

function pushToast(
  title: ReactNode,
  variant: ToastVariant,
  options: ToastOptions = {},
): number {
  const id = options.id ?? state.nextId++;
  const item: ToastItem = {
    id,
    title,
    description: options.description,
    variant,
    duration: options.duration ?? (variant === "error" ? 6000 : 4000),
  };

  const existing = state.toasts.findIndex((toast) => toast.id === id);
  if (existing >= 0) {
    const next = [...state.toasts];
    next.splice(existing, 1, item);
    setToasts(next);
  } else {
    setToasts([...state.toasts, item]);
  }

  return id;
}

/** Removes one toast, or every toast when `id` is omitted. */
export function dismissToast(id?: number): void {
  if (state.toasts.length === 0) {
    return;
  }
  setToasts(
    id === undefined
      ? EMPTY_TOASTS
      : state.toasts.filter((toast) => toast.id !== id),
  );
}

/**
 * The `toast` helper — call from any client component.
 * `toast.success` / `toast.error` / `toast.info` / `toast.loading` /
 * `toast.dismiss` mirror sonner's names so later tasks read identically.
 */
export const toast = {
  /** Neutral toast (no icon colour emphasis). */
  message(title: ReactNode, options?: ToastOptions): number {
    return pushToast(title, "default", options);
  },
  /** Success feedback — the "Kudos sent" moment. */
  success(title: ReactNode, options?: ToastOptions): number {
    return pushToast(title, "success", options);
  },
  /** Failure feedback — e.g. a reaction that could not be saved. */
  error(title: ReactNode, options?: ToastOptions): number {
    return pushToast(title, "error", options);
  },
  /** Neutral informational feedback. */
  info(title: ReactNode, options?: ToastOptions): number {
    return pushToast(title, "info", options);
  },
  /** Persistent in-flight toast; pair with `success`/`error` on the same `id`. */
  loading(title: ReactNode, options?: ToastOptions): number {
    return pushToast(title, "loading", { duration: Infinity, ...options });
  },
  /** Dismiss one toast by id, or all of them. */
  dismiss(id?: number): void {
    dismissToast(id);
  },
};

export default toast;

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

/** Variant → token class for the icon (colour comes from `currentColor`). */
const VARIANT_ICON_CLASSES: Record<ToastVariant, string> = {
  default: "text-muted-foreground",
  success: "text-success",
  error: "text-destructive",
  info: "text-info",
  loading: "text-muted-foreground",
};

/** Inline icon, stroked with `currentColor` so tokens do all the colour work. */
function ToastIcon({ variant }: { variant: ToastVariant }) {
  if (variant === "loading") {
    return (
      <span
        aria-hidden="true"
        data-testid="toast-spinner"
        className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-pill border-2 border-current border-t-transparent motion-reduce:animate-none"
      />
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      {variant === "success" ? (
        <path d="M4.5 10.5l3.5 3.5 7.5-8" />
      ) : variant === "error" ? (
        <>
          <path d="M10 4.5v6.5" />
          <path d="M10 14.5h.01" />
        </>
      ) : (
        <>
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 9v4.5" />
          <path d="M10 6.6h.01" />
        </>
      )}
    </svg>
  );
}

/** A single toast row. Owns its fade-in and its auto-dismiss timer. */
function ToastRow({ item }: { item: ToastItem }) {
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Fade in one frame after mount (opacity only — the reduced-motion-safe move).
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Auto-dismiss after `duration`, paused while hovered so a reader can linger.
  // Re-arming on un-hover grants the full window again rather than cutting the
  // toast short, which is the safe direction for feedback.
  useEffect(() => {
    if (!Number.isFinite(item.duration) || hovered) {
      return undefined;
    }
    const timer = window.setTimeout(() => dismissToast(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.duration, item.id, hovered]);

  return (
    <div
      role={item.variant === "error" ? "alert" : "status"}
      data-variant={item.variant}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-card border border-border bg-card px-3.5 py-3 shadow-popover transition duration-base ease-enter",
        "motion-reduce:transition-none",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <span className={cn("mt-0.5", VARIANT_ICON_CLASSES[item.variant])}>
        <ToastIcon variant={item.variant} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-body-s font-medium text-foreground">{item.title}</p>
        {item.description ? (
          <p className="type-caption mt-0.5 text-muted-foreground">
            {item.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        aria-label="Dismiss notification"
        className={cn(
          "-m-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted-foreground",
          "transition duration-fast ease-enter hover:bg-muted hover:text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        )}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          className="h-3.5 w-3.5"
        >
          <path d="M4 4l8 8" />
          <path d="M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}

/** Props accepted by {@link Toaster}. */
export interface ToasterProps {
  /** Where the stack appears. Defaults to the bottom-right corner. */
  position?: "top-right" | "bottom-right" | "bottom-center" | "top-center";
  /** How many toasts render at once. Defaults to 3. */
  limit?: number;
}

const POSITION_CLASSES: Record<NonNullable<ToasterProps["position"]>, string> = {
  "top-right": "top-0 right-0",
  "bottom-right": "bottom-0 right-0",
  "bottom-center": "bottom-0 left-1/2 -translate-x-1/2",
  "top-center": "top-0 left-1/2 -translate-x-1/2",
};

function subscribe(listener: ToastListener): () => void {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

/** Reads the module store without a provider and without tearing. */
function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    subscribe,
    () => state.toasts,
    () => EMPTY_TOASTS,
  );
}

/**
 * Mounts the toast viewport. Render `<Toaster />` once, near the root layout.
 * It renders nothing at all until a toast is pushed, so it is inert for every
 * page that never gives action feedback.
 */
export function Toaster({ position = "bottom-right", limit = 3 }: ToasterProps) {
  const toasts = useToasts();
  const visible = toasts.slice(-Math.max(limit, 1));

  if (visible.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Notifications"
      aria-live="polite"
      aria-atomic="false"
      data-testid="toaster"
      className={cn(
        "pointer-events-none fixed z-50 flex w-auto flex-col gap-2 p-4",
        POSITION_CLASSES[position],
      )}
    >
      {visible.map((item) => (
        <ToastRow key={item.id} item={item} />
      ))}
    </section>
  );
}
