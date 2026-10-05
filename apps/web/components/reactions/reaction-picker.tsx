"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { cn, FOCUS_RING } from "../../components/ui/cn";
import { toast } from "../../components/ui/toaster";
import { isApiError } from "../../lib/api-client";
import { setReaction } from "../../lib/api/reactions";
import {
  REACTION_EMOJI_SET,
  isReactionEmoji,
  type Kudos,
  type ReactionEmoji,
  type ReactionSummary,
} from "../../lib/api/types";
import { ReactionChip, type ReactionChipState } from "./reaction-chip";

/**
 * ReactionPicker (`cmp-reaction-picker`) — the chip row plus the 4-emoji popover.
 *
 * This is the client island the architecture rule allows: it owns local state,
 * fires the reaction request and runs the optimistic update. Everything around
 * it on the board stays on the server.
 *
 * ## Replace semantics (C-4 / ADR-4 → AC-14, AC-15)
 *
 * The endpoint is an upsert-replace, so a pick — whether it repeats the current
 * emoji or switches to a different one — *moves* the single "mine" pill and
 * adjusts **both** counts. {@link applyReactionPick} is the pure reducer that
 * guarantees the invariant: after every optimistic step exactly one row is
 * `mine`, because `mine` is stripped from every other row before it is set on
 * the picked one. There is deliberately **no toggle-to-remove**: nothing in the
 * product removes a reaction.
 *
 * ## Optimistic flow
 *
 * 1. The popover closes and the picked chip flips to `updating` (it pulses).
 * 2. The counts move immediately — the UI never waits for the wire.
 * 3. `setReaction` PUTs `{ emoji }`; the 2xx body is the ADR-7 kudos, whose
 *    `reactions` array *is* the reconciled truth, so the row is set from it.
 * 4. On failure the pre-pick snapshot is restored (state `failed`), the toast
 *    "Couldn't save that reaction" is shown, and a 401 is reported through
 *    `onUnauthorized` so the board can route to `/signin`.
 *
 * ## Keyboard (a11y requirement)
 *
 * The popover is a labelled `role="menu"` of `menuitemradio` options:
 * `Escape` closes and returns focus to the trigger, `←`/`→`/`↑`/`↓` move with
 * wrap-around, `Home`/`End` jump, and `Enter`/`Space` select through the
 * buttons' native activation. Every chip and every emoji button keeps the amber
 * focus-visible ring.
 */

/** Toast shown when a pick could not be saved (board microcopy). */
export const REACTION_FAILED_TOAST = "Couldn't save that reaction";

/** Accessible name of the open popover. */
export const PICKER_MENU_LABEL = "Pick a reaction";

/** Helper text inside the popover, mirroring the board microcopy. */
export const PICKER_HELPER_TEXT =
  "One reaction per person; picking again switches your emoji.";

/** Visible text on the popover trigger. */
const REACT_TRIGGER_TEXT = "React";

/** Index of `emoji` in the curated set, or `-1` when it is not a member. */
function emojiIndexOf(emoji: string): number {
  return (REACTION_EMOJI_SET as readonly string[]).indexOf(emoji);
}

/**
 * Pure optimistic reducer: moves the viewer's single reaction to `emoji`.
 *
 * Guarantees, in order:
 *
 * 1. Every row loses `mine`; a row whose count drops to `0` disappears.
 * 2. The picked emoji gains one and is `mine` — appended when nobody had it.
 * 3. Existing order is preserved, so the row does not shuffle under the cursor.
 *
 * Returns the input by reference when nothing would change (a repeat pick),
 * which keeps React state updates cheap.
 */
export function applyReactionPick(
  reactions: readonly ReactionSummary[],
  emoji: string,
): readonly ReactionSummary[] {
  const mineEmoji = reactions.find((row) => row.mine)?.emoji;

  // A repeat of the current emoji: upsert-replace leaves the counts as they are.
  if (mineEmoji === emoji) return reactions;

  const next: ReactionSummary[] = [];
  for (const row of reactions) {
    if (row.emoji === emoji) {
      next.push({ emoji, count: row.count + 1, mine: true });
    } else if (row.mine) {
      if (row.count > 1) {
        next.push({ ...row, count: row.count - 1, mine: false });
      }
    } else {
      next.push(row);
    }
  }

  if (!next.some((row) => row.emoji === emoji && row.mine)) {
    next.push({ emoji, count: 1, mine: true });
  }

  return next;
}

/** Props for {@link ReactionPicker}. */
export interface ReactionPickerProps {
  /** The kudos being reacted to — the `:id` of EP-5. */
  readonly kudosId: string;
  /**
   * The kudos' current aggregated reactions (ADR-7). Treated as the server
   * truth: the row syncs back to it whenever no pick is in flight, so a 15s
   * poll merge lands here without clobbering an optimistic update.
   */
  readonly reactions?: readonly ReactionSummary[];
  /** Called with the full updated kudos after a successful pick. */
  readonly onReactionSaved?: (kudos: Kudos) => void;
  /** Called when the API answers 401 — the board routes to `/signin`. */
  readonly onUnauthorized?: () => void;
  /** Extra class names for the wrapper. */
  readonly className?: string;
}

/**
 * The chip row + popover for one kudos.
 *
 * Renders as an inline-flex row so a card can drop it straight under the
 * message; below 768px the row simply wraps.
 */
export function ReactionPicker({
  kudosId,
  reactions = [],
  onReactionSaved,
  onUnauthorized,
  className,
}: ReactionPickerProps) {
  const [rows, setRows] = useState<readonly ReactionSummary[]>(reactions);
  const [open, setOpen] = useState(false);
  const [pendingEmoji, setPendingEmoji] = useState<string | null>(null);
  const [failedEmoji, setFailedEmoji] = useState<string | null>(null);

  /** The pre-pick snapshot, restored verbatim when a pick fails. */
  const snapshotRef = useRef<readonly ReactionSummary[] | null>(null);
  /** True while a pick is in flight — guards the props-sync effect. */
  const pendingRef = useRef(false);
  /** Popover option buttons, indexed like `REACTION_EMOJI_SET`. */
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** The trigger, which regains focus when the popover closes. */
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /** The whole picker; used to detect activation outside of it. */
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** Option to focus once the open popover has mounted. */
  const focusOnOpenRef = useRef<number | null>(null);

  // Adopt fresh server truth whenever no pick is in flight. During a pick the
  // optimistic row is authoritative; the 2xx body reconciles it in `pick`.
  useEffect(() => {
    if (pendingRef.current) return;
    setRows(reactions);
    setFailedEmoji(null);
  }, [reactions]);

  // Close on activation outside the picker (pointerdown, the earliest phase).
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;

    function handlePointerDown(event: Event): void {
      if (
        root &&
        event.target instanceof Node &&
        root.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("mousedown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [open]);

  const focusOption = useCallback((index: number): void => {
    const count = REACTION_EMOJI_SET.length;
    const wrapped = ((index % count) + count) % count;
    optionRefs.current[wrapped]?.focus();
  }, []);

  // Focus the requested option as soon as the open popover has mounted.
  useEffect(() => {
    if (!open || focusOnOpenRef.current === null) return;
    const index = focusOnOpenRef.current;
    focusOnOpenRef.current = null;
    focusOption(index);
  }, [open, focusOption]);

  /** Opens the popover, focusing `preferred` (the mine emoji by default). */
  const openMenu = useCallback(
    (preferred?: string): void => {
      const mineEmoji = rows.find((row) => row.mine && isReactionEmoji(row.emoji))
        ?.emoji;
      const target = preferred ?? mineEmoji ?? REACTION_EMOJI_SET[0];
      focusOnOpenRef.current = Math.max(emojiIndexOf(target), 0);
      setOpen(true);
    },
    [rows],
  );

  /** Closes the popover, optionally returning focus to the trigger. */
  const closeMenu = useCallback((restoreFocus = true): void => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  function handleMenuKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void {
    const count = REACTION_EMOJI_SET.length;
    const current = optionRefs.current.findIndex(
      (node) => node !== null && node === document.activeElement,
    );

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        closeMenu(true);
        return;
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusOption(current < 0 ? 0 : current + 1);
        return;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusOption(current < 0 ? count - 1 : current - 1);
        return;
      case "Home":
        event.preventDefault();
        focusOption(0);
        return;
      case "End":
        event.preventDefault();
        focusOption(count - 1);
        return;
      case "Tab":
        // Let focus leave naturally; the popover closes behind it.
        setOpen(false);
        return;
      default:
        return;
      // Enter and Space fall through: a native <button> activates itself.
    }
  }

  /** Selects `emoji` — optimistically now, reconciled by the 2xx body. */
  async function pick(emoji: ReactionEmoji): Promise<void> {
    if (pendingRef.current) return;

    closeMenu(true);

    const snapshot = rows;
    snapshotRef.current = snapshot;
    pendingRef.current = true;
    setFailedEmoji(null);
    setPendingEmoji(emoji);
    setRows(applyReactionPick(snapshot, emoji));

    try {
      const updated = await setReaction(kudosId, emoji);
      // The 2xx body is the ADR-7 kudos: its reactions ARE the reconciled row.
      setRows(updated.reactions);
      setPendingEmoji(null);
      setFailedEmoji(null);
      onReactionSaved?.(updated);
    } catch (error: unknown) {
      setRows(snapshotRef.current ?? snapshot);
      setPendingEmoji(null);
      setFailedEmoji(emoji);
      toast.error(REACTION_FAILED_TOAST);
      if (isApiError(error) && error.isUnauthorized) onUnauthorized?.();
    } finally {
      snapshotRef.current = null;
      pendingRef.current = false;
    }
  }

  /** A chip's state, derived from the optimistic bookkeeping above. */
  function chipState(emoji: string, mine: boolean): ReactionChipState {
    if (pendingEmoji === emoji) return "updating";
    if (failedEmoji === emoji) return "failed";
    return mine ? "mine" : "default";
  }

  const busy = pendingEmoji !== null;

  return (
    <div
      ref={rootRef}
      data-state={open ? "open" : busy ? "selecting" : "closed"}
      data-testid="reaction-picker"
      className={cn(
        "relative inline-flex max-w-full flex-wrap items-center gap-2",
        className,
      )}
    >
      <ul
        data-testid="reaction-chip-row"
        aria-label="Reactions"
        className="flex flex-wrap items-center gap-2"
      >
        {rows.map((row) => (
          <li key={row.emoji}>
            <ReactionChip
              emoji={row.emoji}
              count={row.count}
              mine={row.mine}
              state={chipState(row.emoji, row.mine)}
              disabled={busy}
              onSelect={() => openMenu(row.emoji)}
            />
          </li>
        ))}
      </ul>

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-label={REACT_TRIGGER_TEXT}
        data-testid="reaction-picker-trigger"
        onClick={() => (open ? closeMenu(true) : openMenu())}
        disabled={busy}
        className={cn(
          "inline-flex select-none items-center gap-1.5 rounded-pill border px-2.5 py-1",
          "border-border text-body-s font-medium text-muted-foreground transition duration-base ease-enter",
          "hover:border-muted-foreground/40 hover:bg-muted hover:text-foreground",
          FOCUS_RING,
          "disabled:pointer-events-none disabled:opacity-60",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          className="flex-none"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" />
          <path d="M9 9.5h.01M15 9.5h.01" />
        </svg>
        {REACT_TRIGGER_TEXT}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={PICKER_MENU_LABEL}
          onKeyDown={handleMenuKeyDown}
          data-testid="reaction-picker-menu"
          className="absolute bottom-full left-0 z-40 mb-2 rounded-card border border-border bg-card p-2 shadow-popover"
        >
          <div
            role="group"
            aria-label={PICKER_MENU_LABEL}
            className="flex items-center gap-1"
          >
            {REACTION_EMOJI_SET.map((emoji, index) => {
              const mine = rows.some(
                (row) => row.emoji === emoji && row.mine,
              );
              return (
                <button
                  key={emoji}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={mine}
                  aria-label={`React ${emoji}${mine ? " — your reaction" : ""}`}
                  data-testid={`reaction-option-${emoji}`}
                  data-mine={mine ? "true" : "false"}
                  onClick={() => void pick(emoji)}
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-control text-[18px] leading-none",
                    "transition duration-fast ease-enter",
                    FOCUS_RING,
                    mine
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted active:bg-muted",
                  )}
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-caption text-muted-foreground">
            {PICKER_HELPER_TEXT}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default ReactionPicker;
