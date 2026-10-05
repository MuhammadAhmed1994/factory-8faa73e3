"use client";

/**
 * HideControl (`cmp-card`'s lead-only action, scr-board-lead).
 *
 * The quiet two-step moderation affordance (US-5 / ADR-5):
 *
 * 1. A ghost icon button — lucide `eye-off`, labelled `Hide this kudos from the
 *    board` — sitting in the card's tab order. It renders **only** when the
 *    session role is `LEAD`; for a regular member the component returns `null`,
 *    never a CSS-hidden control, so a member's DOM carries no moderation
 *    affordance at all (AC-19).
 * 2. Clicking it opens a small focus-trapped confirm popover with a single
 *    destructive action, `Hide from board`. No undo exists (there is no unhide
 *    endpoint), so this confirmation carries the safety instead.
 *
 * Outcomes, each distinct:
 *
 * - **2xx**  → `Hiding…` spinner resolves into the toast
 *   `Hidden from the board for everyone.`, the card fades out over ~200ms, and
 *   `onHidden(kudosId)` fires so the board drops it. Other sessions converge on
 *   their next 15s poll (AC-17 / AC-19).
 * - **403**  → the popover stays open with the info alert
 *   `Only team leads can hide kudos.` — a defensive state: the UI never offers
 *   the control to a member, but the API's role check is still rendered.
 * - **401**  → a sign-in notice, since the session is gone.
 * - *else*   → `Couldn't hide that kudos. Try again.` with the card unchanged
 *   and the destructive action still armed.
 *
 * Escape cancels and returns focus to the trigger; Tab cycles inside the
 * popover (focus is trapped while it is open).
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Alert } from "@/components/ui/alert";
import { cn, FOCUS_RING } from "@/components/ui/cn";
import { toast } from "@/components/ui/toaster";
import { UNAUTHORIZED_MESSAGE, type MemberRole } from "@/lib/api-client";
import {
  hideKudos,
  HIDING_MESSAGE,
  HIDDEN_FROM_BOARD_TOAST,
  HIDE_FAILED_MESSAGE,
  HIDE_FORBIDDEN_MESSAGE,
  SIGN_IN_PATH,
  type HideKudosOptions,
} from "@/lib/api/moderation";

/** Accessible name of the trigger (a11y requirement, scr-board-lead). */
export const HIDE_CONTROL_LABEL = "Hide this kudos from the board";

/** The destructive confirm action — the only way to actually hide. */
export const HIDE_CONFIRM_LABEL = "Hide from board";

/** Popover heading; no undo exists, so the copy states the consequence. */
export const HIDE_CONFIRM_HEADING = "Hide this kudos?";

/** Cancel affordance; Escape does the same. */
export const HIDE_CANCEL_LABEL = "Cancel";

/** Body copy explaining what hiding does (scr-board-lead helper). */
export const HIDE_CONFIRM_BODY =
  "Hiding removes a kudos from the board for everyone.";

/**
 * How long the card takes to fade out once the hide succeeds. The design
 * system's `base` beat (200ms), which is also what `prefers-reduced-motion`
 * collapses every animation to — so the exit reads identically either way.
 */
export const CARD_FADE_MS = 200;

/** The same beat as a CSS value, for the imperative fade below. */
const CARD_FADE_CSS = "opacity 200ms ease-out";

/** Selector of the card element this control fades out. */
const CARD_SELECTOR = ".kudos-card";

/** Lucide `eye-off`, the moderation glyph. Decorative — the label carries meaning. */
function EyeOffIcon({ className }: { readonly className?: string }) {
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
      className={className}
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575a1 1 0 0 1 0 .696a10.8 10.8 0 0 1-1.444 2.49m-6.41-.679a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 4.446-5.143M2 2l20 20" />
    </svg>
  );
}

/** The pending spinner; inherits `currentColor` and is purely decorative. */
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
        strokeWidth={3}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Props for {@link HideControl}. */
export interface HideControlProps {
  /** The kudos this control hides; forwarded to `POST /kudos/:id/hide`. */
  readonly kudosId: string;
  /** Session role from `GET /api/v1/auth/session`; only `LEAD` renders. */
  readonly role: MemberRole;
  /**
   * Fired with the hidden kudos id once the API answers 2xx — the board's cue
   * to drop the card. Called after the ~200ms exit fade has been started.
   */
  readonly onHidden: (kudosId: string) => void;
  /** Extra class names appended after the trigger's own. */
  readonly className?: string;
  /** Transport-level knobs forwarded to `hideKudos` (baseUrl, signal…). */
  readonly options?: HideKudosOptions;
}

/**
 * The lead-only hide control with its confirm popover.
 *
 * A Client Component because it owns popover, pending and failure state.
 */
export function HideControl({
  kudosId,
  role,
  onHidden,
  className,
  options,
}: HideControlProps) {
  // Members never receive the control — not hidden with CSS, simply not built.
  if (role !== "LEAD") return null;

  return (
    <HideControlForLead
      kudosId={kudosId}
      onHidden={onHidden}
      className={className}
      options={options}
    />
  );
}

/** Props for {@link HideControlForLead}; the role check has already happened. */
interface HideControlForLeadProps {
  readonly kudosId: string;
  readonly onHidden: (kudosId: string) => void;
  readonly className?: string;
  readonly options?: HideKudosOptions;
}

/** Which inline notice the popover is showing, if any. */
type HideNotice = "forbidden" | "unauthorized" | "failed" | null;

/**
 * The rendered control. Split from {@link HideControl} so the member path is an
 * early `return null` in the public component and cannot regress into a
 * CSS-hidden render.
 */
function HideControlForLead({
  kudosId,
  onHidden,
  className,
  options,
}: HideControlForLeadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [notice, setNotice] = useState<HideNotice>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const fadeTimerRef = useRef<number | null>(null);

  const headingId = useId();
  const bodyId = useId();

  /** Closes the popover and hands focus back to the trigger. */
  const closePopover = useCallback(() => {
    setIsOpen(false);
    setNotice(null);
    triggerRef.current?.focus();
  }, []);

  /** Starts the ~200ms exit fade on the enclosing card, then reports the hide. */
  const fadeOutAndReport = useCallback(() => {
    const card =
      typeof triggerRef.current?.closest === "function"
        ? (triggerRef.current.closest(CARD_SELECTOR) as HTMLElement | null)
        : null;

    if (card === null) {
      onHidden(kudosId);
      return;
    }

    // An opacity fade only: this *is* the reduced-motion fallback, so it runs
    // identically with animation preferences on or off.
    card.style.transition = CARD_FADE_CSS;
    card.style.opacity = "0";
    card.setAttribute("data-hiding", "true");

    fadeTimerRef.current = window.setTimeout(() => {
      fadeTimerRef.current = null;
      onHidden(kudosId);
    }, CARD_FADE_MS);
  }, [kudosId, onHidden]);

  // Focus moves into the popover as it opens, so the confirm action is reached
  // without another Tab; Escape returns it to the trigger via closePopover.
  useEffect(() => {
    if (!isOpen) return;
    confirmRef.current?.focus();
  }, [isOpen]);

  // Clears a pending exit fade if the card unmounts before it completes.
  useEffect(
    () => () => {
      if (fadeTimerRef.current !== null) {
        window.clearTimeout(fadeTimerRef.current);
      }
    },
    [],
  );

  /** Traps Tab inside the popover and cancels on Escape. */
  const handlePopoverKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!isPending) closePopover();
        return;
      }

      if (event.key !== "Tab") return;

      const popover = popoverRef.current;
      if (popover === null) return;

      const focusable = popover.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === popover)) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [closePopover, isPending],
  );

  /** The destructive action: POST /kudos/:id/hide and map the outcome. */
  const confirmHide = useCallback(() => {
    if (isPending) return;

    setIsPending(true);
    setNotice(null);

    void hideKudos(kudosId, options).then((outcome) => {
      if (outcome.kind === "hidden") {
        toast.success(HIDDEN_FROM_BOARD_TOAST);
        fadeOutAndReport();
        return;
      }

      // Every non-2xx keeps the popover open: the card is unchanged and the
      // lead can read exactly what went wrong.
      setIsPending(false);
      if (outcome.kind === "forbidden") setNotice("forbidden");
      else if (outcome.kind === "unauthorized") setNotice("unauthorized");
      else setNotice("failed");
    });
  }, [fadeOutAndReport, isPending, kudosId, options]);

  return (
    <span className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={HIDE_CONTROL_LABEL}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title={HIDE_CONTROL_LABEL}
        data-kudos-id={kudosId}
        onClick={() => {
          if (isOpen) {
            closePopover();
            return;
          }
          setIsOpen(true);
        }}
        className={cn(
          "inline-grid h-8 w-8 place-items-center rounded-pill bg-transparent text-muted-foreground",
          "transition duration-base ease-enter hover:bg-muted hover:text-foreground active:bg-muted",
          FOCUS_RING,
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <EyeOffIcon className="h-4 w-4" />
      </button>

      {isOpen ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={headingId}
          aria-describedby={bodyId}
          data-state="open"
          onKeyDown={handlePopoverKeyDown}
          className="absolute right-0 top-10 z-30 w-64 rounded-card border border-border bg-card p-4 shadow-popover"
        >
          <p
            id={headingId}
            className="font-heading text-heading-s text-foreground"
          >
            {HIDE_CONFIRM_HEADING}
          </p>

          <p
            id={bodyId}
            className="mt-1 text-caption leading-4 text-muted-foreground"
          >
            {HIDE_CONFIRM_BODY}
          </p>

          {notice !== null ? (
            <div className="mt-3">
              {notice === "forbidden" ? (
                <Alert variant="info">{HIDE_FORBIDDEN_MESSAGE}</Alert>
              ) : notice === "unauthorized" ? (
                <Alert variant="info">
                  {UNAUTHORIZED_MESSAGE}.{" "}
                  <a href={SIGN_IN_PATH} className="underline underline-offset-2">
                    Sign in
                  </a>
                </Alert>
              ) : (
                <Alert variant="error">{HIDE_FAILED_MESSAGE}</Alert>
              )}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closePopover}
              disabled={isPending}
              className={cn(
                "inline-flex h-8 items-center rounded-control px-3 text-body-s font-medium",
                "bg-transparent text-muted-foreground transition duration-base ease-enter",
                "hover:bg-muted hover:text-foreground",
                FOCUS_RING,
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              {HIDE_CANCEL_LABEL}
            </button>

            {/*
             * Hand-rolled rather than the shared `Button`: the pending state
             * must carry the exact copy `Hiding…` as its visible text, without
             * a second, generic screen-reader string layered on top of it.
             */}
            <button
              ref={confirmRef}
              type="button"
              onClick={confirmHide}
              disabled={isPending}
              aria-busy={isPending}
              data-pending={isPending ? "true" : "false"}
              className={cn(
                "inline-flex h-8 items-center justify-center gap-2 rounded-control px-3",
                "bg-destructive text-destructive-foreground text-body-s font-medium shadow-card",
                "transition duration-base ease-enter hover:brightness-110 active:brightness-95",
                FOCUS_RING,
                "disabled:pointer-events-none disabled:opacity-70",
              )}
            >
              {isPending ? <Spinner /> : null}
              {isPending ? HIDING_MESSAGE : HIDE_CONFIRM_LABEL}
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}

export default HideControl;
