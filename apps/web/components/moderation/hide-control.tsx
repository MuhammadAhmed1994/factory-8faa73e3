"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

import Alert from "@/components/ui/alert";
import Button from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import {
  HIDE_CANCEL_LABEL,
  HIDE_CONFIRM_ACTION_LABEL,
  HIDE_CONFIRM_BODY,
  HIDE_CONFIRM_TITLE,
  HIDE_CONTROL_LABEL,
  HIDE_FAILED_MESSAGE,
  HIDE_FORBIDDEN_MESSAGE,
  HIDING_LABEL,
  HIDDEN_TOAST_MESSAGE,
  hideKudos,
  isLeadRole,
  type ModerationFailureKind,
} from "@/lib/api/moderation";
import type { MemberRole } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * HideControl — the quiet, lead-only moderation affordance on a kudos card
 * (cmp-card's "lead-only hide control", scr-board-lead).
 *
 * Lead-gated at the **render** level, never with CSS: a member's board calls
 * `<HideControl role="MEMBER" … />` and gets `null`, so the button is absent
 * from the DOM, the tab order and every accessibility tree — which is exactly
 * what AC-19's "the control is not rendered for a regular member" demands.
 *
 * Two-step hide, because **no undo exists** (ADR-5 has no unhide endpoint): the
 * confirmation carries the safety instead.
 *
 * 1. The trigger is a ghost icon button (low-contrast, `--muted-foreground`)
 *    with the eye-off glyph and the accessible name "Hide this kudos from the
 *    board" — the label lives in `aria-label` at every breakpoint, so the
 *    control collapses to icon-only below 768px without losing its name.
 * 2. Clicking opens a focus-trapped confirm popover. The destructive "Hide from
 *    board" action is the only `--destructive` fill on the board; Escape and a
 *    focus that leaves the popover both cancel. There is no undo affordance.
 *
 * Then the designed states (scr-board-lead):
 *
 * | state       | what happens                                                     |
 * |-------------|------------------------------------------------------------------|
 * | `idle`      | trigger only.                                                    |
 * | `confirming`| popover open, focus trapped on the destructive action.           |
 * | `hiding`    | popover stays, action shows the "Hiding…" spinner and is disabled.|
 * | `hidden`    | 2xx → `onHidden(kudosId)` fires, the card fades out (~200ms) and the "Hidden from the board for everyone." toast confirms (AC-17/AC-19). |
 * | `forbidden` | 403 → popover stays open with the info alert "Only team leads can hide kudos." (AC-18's designed defensive state). |
 * | `failed`    | anything else → "Couldn't hide that kudos. Try again.", card unchanged, retry available. |
 */

/** The control's five designed states. */
export type HideControlState =
  | "idle"
  | "confirming"
  | "hiding"
  | "forbidden"
  | "failed";

/** Props accepted by {@link HideControl}. */
export interface HideControlProps {
  /** Id of the kudos this control hides — forwarded to `onHidden` on 2xx. */
  kudosId: string;
  /** Session role; anything other than `"LEAD"` renders nothing at all. */
  role?: MemberRole | null;
  /**
   * Fires with the hidden kudos' id on a 2xx hide, after the toast. The board
   * removes the card from its list — with the ~200ms exit fade — so the kudos
   * is gone from this board immediately; every other session drops it on its
   * next 15s poll (AC-19).
   */
  onHidden?: (kudosId: string) => void;
  /** 401 from the hide call: the session is gone. Defaults to a no-op. */
  onUnauthenticated?: () => void;
  /** Extra classes for the trigger. */
  className?: string;
}

/**
 * The focus-trap is expressed as component-scoped CSS, so it lives with the
 * popover it protects. Every colour resolves through the design system's CSS
 * variables — no hardcoded colour anywhere.
 */
const HIDE_CONTROL_CSS = `
.hide-control { position: relative; }
.hide-control__trigger { color: var(--muted-foreground); }
.hide-control__trigger:hover,
.hide-control__trigger[aria-expanded="true"] { color: var(--secondary); }
.hide-control__popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 30;
  width: min(20rem, calc(100vw - 32px));
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--card);
  color: var(--card-foreground);
  box-shadow: var(--shadow-popover);
}
.hide-control__title {
  margin: 0 0 4px;
  font-family: var(--font-heading);
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
}
.hide-control__body {
  margin: 0 0 12px;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 18px;
  color: var(--muted-foreground);
}
.hide-control__notice { margin-bottom: 12px; }
.hide-control__actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
@media (prefers-reduced-motion: reduce) {
  .hide-control__popover { animation: hide-popover-fade 200ms linear 1 both; }
}
@keyframes hide-popover-fade { 0% { opacity: 0; } 100% { opacity: 1; } }
`;

export function HideControl({
  kudosId,
  role,
  onHidden,
  onUnauthenticated,
  className,
}: HideControlProps) {
  // Lead gate. `null` for every other role — never CSS-hidden (AC-19).
  if (!isLeadRole(role)) {
    return null;
  }

  return (
    <LeadHideControl
      kudosId={kudosId}
      onHidden={onHidden}
      onUnauthenticated={onUnauthenticated}
      className={className}
    />
  );
}

/**
 * Inner component, mounted only for leads — so no hook runs at all for a
 * member and the gate stays a plain early return above.
 */
function LeadHideControl({
  kudosId,
  onHidden,
  onUnauthenticated,
  className,
}: Omit<HideControlProps, "role">) {
  // `useId` defaults contain `:` / `«»`, which are neither valid HTML ids nor
  // selector-safe; strip them so the aria wiring stays resolvable.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const popoverId = `hide-popover-${uid}`;
  const titleId = `${popoverId}-title`;
  const noticeId = `${popoverId}-notice`;

  const [open, setOpen] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [failure, setFailure] = useState<ModerationFailureKind | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const state: HideControlState = hiding
    ? "hiding"
    : open
      ? failure === "forbidden"
        ? "forbidden"
        : failure === null
          ? "confirming"
          : "failed"
      : "idle";

  /** Closes the popover, clears any notice and returns focus to the trigger. */
  const close = useCallback((restoreFocus = true): void => {
    setOpen(false);
    setHiding(false);
    setFailure(null);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  // Escape cancels the confirmation (a11y spec) and puts focus back on the
  // trigger. Bound on `window` only while the popover is open.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, close]);

  // Move focus into the popover the moment it opens (and again when a notice
  // replaces the action), so the destructive confirm is what a keyboard user
  // lands on — the trap below then keeps focus inside until cancelled.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      confirmRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, failure]);

  /** Keeps keyboard focus inside the open popover (Tab / Shift+Tab cycle). */
  const trapTab = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Tab") {
      return;
    }
    const container = event.currentTarget;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last =
      focusable.length > 0 ? focusable[focusable.length - 1] : undefined;
    if (first === undefined || last === undefined) {
      return;
    }
    const active = container.ownerDocument.activeElement;
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && (active === first || active === container)) {
      event.preventDefault();
      last.focus();
    }
  }, []);

  /** Cancels when focus escapes the popover entirely (blur-to-dismiss). */
  const handlePopoverBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>): void => {
      if (!open) {
        return;
      }
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) {
        return;
      }
      close(false);
    },
    [open, close],
  );

  /** Opens the confirm popover; a fresh open starts with no notice. */
  const openPopover = useCallback((): void => {
    setFailure(null);
    setHiding(false);
    setOpen(true);
  }, []);

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (hiding) {
      return; // already in flight — the action cannot be double-fired
    }

    setHiding(true);
    setFailure(null);

    // Outcome, not exception: `hideKudos` never throws (see lib/api/moderation).
    const outcome = await hideKudos(kudosId);

    if (outcome.ok) {
      // 2xx — the kudos is gone for everyone. Announce it, hand the id to the
      // board so the card fades out (~200ms), and reset the control.
      setHiding(false);
      setOpen(false);
      setFailure(null);
      toast.success(HIDDEN_TOAST_MESSAGE);
      onHidden?.(kudosId);
      triggerRef.current?.focus();
      return;
    }

    setHiding(false);
    setFailure(outcome.kind);
    if (outcome.kind === "unauthenticated") {
      // The session is gone — the board owns the redirect to /signin.
      setOpen(false);
      onUnauthenticated?.();
      return;
    }

    // 403 keeps the popover open with the info notice; any other failure keeps
    // it open with the retry copy. The card is untouched either way.
    toast.error(
      outcome.kind === "forbidden"
        ? HIDE_FORBIDDEN_MESSAGE
        : HIDE_FAILED_MESSAGE,
    );
  }, [hiding, kudosId, onHidden, onUnauthenticated]);

  const notice =
    failure === "forbidden"
      ? HIDE_FORBIDDEN_MESSAGE
      : failure === "network" || failure === "error"
        ? HIDE_FAILED_MESSAGE
        : null;

  const triggerClass = cn(
    "hide-control__trigger",
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill",
    "transition duration-fast ease-enter hover:bg-muted",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60",
    className,
  );

  return (
    <span className="hide-control" data-state={state}>
      <style dangerouslySetInnerHTML={{ __html: HIDE_CONTROL_CSS }} />

      <button
        ref={triggerRef}
        type="button"
        aria-label={HIDE_CONTROL_LABEL}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        data-testid="hide-control"
        data-state={state}
        disabled={hiding}
        aria-disabled={hiding || undefined}
        onClick={openPopover}
        className={triggerClass}
      >
        {hiding ? (
          <span
            aria-hidden="true"
            data-testid="hide-control-spinner"
            className="inline-block h-4 w-4 animate-spin rounded-pill border-2 border-current border-t-transparent motion-reduce:animate-none"
          />
        ) : (
          /* lucide `eye-off`, stroked with `currentColor` (icon_library: lucide) */
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-[18px] w-[18px]"
          >
            <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575a1 1 0 0 1 0 .696a10.8 10.8 0 0 1-1.444 2.49m-6.41-.679a3 3 0 0 1-4.242-4.242" />
            <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 4.446-5.143M2 2l20 20" />
          </svg>
        )}
      </button>

      {open ? (
        <div
          id={popoverId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          aria-describedby={notice !== null ? noticeId : undefined}
          data-testid="hide-confirm-popover"
          data-state={state}
          className="hide-control__popover"
          onKeyDown={trapTab}
          onBlur={handlePopoverBlur}
        >
          <h3 id={titleId} className="hide-control__title">
            {HIDE_CONFIRM_TITLE}
          </h3>
          <p className="hide-control__body">{HIDE_CONFIRM_BODY}</p>

          {notice !== null ? (
            <Alert
              variant={failure === "forbidden" ? "info" : "error"}
              className="hide-control__notice"
              data-testid="hide-control-notice"
            >
              <span id={noticeId}>{notice}</span>
            </Alert>
          ) : null}

          <div className="hide-control__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => close(true)}
              disabled={hiding}
            >
              {HIDE_CANCEL_LABEL}
            </Button>
            <Button
              ref={confirmRef}
              variant="destructive"
              size="sm"
              loading={hiding}
              onClick={() => {
                void handleConfirm();
              }}
              data-testid="hide-confirm-action"
            >
              {HIDE_CONFIRM_ACTION_LABEL}
            </Button>
          </div>

          {/* The in-flight beat is announced politely, not just spun. */}
          <p role="status" className="sr-only">
            {hiding ? HIDING_LABEL : ""}
          </p>
        </div>
      ) : null}
    </span>
  );
}

export default HideControl;
