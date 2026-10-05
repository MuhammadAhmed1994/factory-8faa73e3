"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import ReactionChip, { REACTION_CHIP_CSS } from "@/components/reactions/reaction-chip";
import { toast } from "@/components/ui/toaster";
import { ApiError } from "@/lib/api-client";
import { setReaction } from "@/lib/api/reactions";
import {
  REACTION_EMOJIS,
  REACTION_EMOJI_INDEX,
  REACTION_EMOJI_NAMES,
  isCuratedReaction,
  normalizeReactions,
  type Kudos,
  type ReactionEmoji,
  type ReactionSummary,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * ReactionPicker — a kudos card's chip row plus the 4-emoji popover
 * (cmp-reaction-picker + cmp-reaction-chip).
 *
 * One component owns the whole reaction surface of a card, because the chip
 * row and the popover are two views of the same state:
 *
 * ```
 *  [🎉 3]  [❤️ 1]   [+ React]      ← the aggregated chip row
 *    └─ mine (amber, filled)
 *            ▼ popover (4 curated emoji)
 *   👍   ❤️   🎉   🙌
 * ```
 *
 * **Replace semantics (ADR-4 / AC-15).** `PUT /kudos/:id/reactions` is an
 * upsert on the caller's `(kudosId, memberId)` pair, so every pick — same
 * emoji *or* different — submits a replacement and returns the kudos with
 * exactly one `mine` summary. The UI mirrors that optimistically *before* the
 * round trip, which is where the invariant is actually defended: the previous
 * `mine` flag is cleared and its count decremented, the target emoji's count
 * is incremented and flagged `mine`, and a zero-count summary stops being a
 * chip. `ensureSingleMine` (in `lib/api/types.ts`) then guarantees that no
 * payload coming back can ever render two.
 *
 * There is deliberately **no toggle-to-remove**: clicking the amber pill or
 * re-picking the same emoji re-submits, and the row still shows one reaction.
 *
 * **Optimism + failure.** The target chip pulses (`data-state="updating"`)
 * while the PUT is in flight and the counts reconcile the moment the 2xx body
 * arrives. On any rejection the chip row is reverted to the pre-pick snapshot
 * and the toast `Couldn't save that reaction` fires. A 401 additionally hands
 * control to `onUnauthenticated` so the board can route to `/signin` (ADR-1).
 *
 * **Keyboard.** The popover is a labelled `menu` of `menuitemradio` options:
 * `Escape` closes it and returns focus to the trigger, `ArrowLeft`/`ArrowRight`
 * (and `ArrowUp`/`ArrowDown`) move between the four emoji, `Enter`/`Space`
 * select, `Home`/`End` jump, and `Tab` closes. Every chip and every emoji
 * button carries the amber focus-visible ring.
 *
 * **Reduced motion.** The chip pulse and the popover entrance each declare a
 * `prefers-reduced-motion` fallback to an opacity-only change.
 */

/** The three designed states of the picker. */
export type ReactionPickerState = "closed" | "open" | "selecting";

/** Trigger copy, pinned by the scr-board microcopy ("React"). */
export const REACTION_TRIGGER_LABEL = "React";

/** Helper copy inside the popover — the board's "one per person" hint. */
export const REACTION_PICKER_HINT =
  "One reaction per person; picking again switches your emoji.";

/** Chip-row classes. */
const ROW_CLASSES = cn(
  "flex flex-wrap items-center gap-1.5",
  "motion-reduce:animate-none",
);

/** Shared trigger focus styling (never removed, always amber). */
const FOCUS_CLASSES = cn(
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-card",
);

/**
 * Popover styles, scoped to the component's own class names.
 *
 * Declared here (not in `app/globals.css`, owned by the scaffold task) and
 * expressed only through design-token variables, so no hex is hardcoded in the
 * component. The entrance is the design system's `slow` (320ms) enter easing;
 * under `prefers-reduced-motion` it collapses to a 200ms opacity fade.
 */
export const REACTION_PICKER_CSS = `
.reaction-picker__popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: max-content;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--card);
  color: var(--card-foreground);
  box-shadow: var(--shadow-popover);
  animation: reaction-picker-enter var(--motion-slow) var(--motion-ease-enter) 1 both;
}
.reaction-picker__options {
  display: flex;
  align-items: center;
  gap: 4px;
}
.reaction-picker__option {
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--foreground);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--motion-ease-enter),
              transform var(--motion-fast) var(--motion-ease-enter);
}
.reaction-picker__option:hover {
  background: var(--muted);
}
.reaction-picker__option[data-mine="true"] {
  background: var(--primary);
  color: var(--primary-foreground);
  border-color: var(--primary);
}
.reaction-picker__option:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.reaction-picker__check {
  display: none;
  position: absolute;
  top: 3px;
  right: 4px;
  font-size: 10px;
  line-height: 1;
}
.reaction-picker__option[aria-checked="true"] .reaction-picker__check {
  display: inline-block;
}
@keyframes reaction-picker-enter {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes reaction-picker-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .reaction-picker__popover {
    animation: reaction-picker-fade 200ms linear 1 both;
  }
  .reaction-picker__option {
    transition: none;
  }
}
`;

/** Props accepted by {@link ReactionPicker}. */
export interface ReactionPickerProps {
  /** The kudos being reacted to; `kudos.reactions` seeds the chip row. */
  kudos: Kudos;
  /**
   * Receives the kudos the API returned after a successful reaction, so the
   * board can refresh its own copy of the card (and its 15s poll merge can
   * dedupe against it by id).
   */
  onKudosChange?: (kudos: Kudos) => void;
  /**
   * The PUT came back 401: the session is gone. The picker stays
   * presentation-only and lets the owner route to `/signin` (ADR-1).
   */
  onUnauthenticated?: () => void;
  /** Extra classes for the chip row wrapper. */
  className?: string;
}

/** Snapshot of the chip row, taken before an optimistic pick. */
type ReactionsSnapshot = readonly ReactionSummary[];

/**
 * Applies the viewer's pick to a chip row, optimistically.
 *
 * Pure on purpose: the same function serves "add my first reaction", "move my
 * reaction to another emoji" and "re-affirm the emoji I already had", and it is
 * what keeps the mine pill unique on screen while the PUT is still in flight.
 *
 * The abandoned emoji loses exactly one count (the viewer's own), the target
 * gains exactly one, and a summary that drops to zero disappears — so moving a
 * reaction never changes how many reactions the kudos has in total.
 */
export function applyOptimisticReaction(
  reactions: readonly ReactionSummary[],
  emoji: ReactionEmoji,
): ReactionSummary[] {
  const next = new Map<string, ReactionSummary>();

  for (const reaction of reactions) {
    if (!reaction.mine) {
      next.set(reaction.emoji, { ...reaction, mine: false });
      continue;
    }

    if (reaction.emoji === emoji) {
      // Re-affirming the emoji already reacted with: nothing moves, the pill
      // simply stays where it is (there is no toggle-to-remove).
      next.set(emoji, { ...reaction, mine: true });
      continue;
    }

    // The abandoned pill's aggregate loses the viewer's one reaction; a zero
    // aggregate is a reaction nobody holds, so it stops being a chip.
    const count = reaction.count - 1;
    if (count > 0) {
      next.set(reaction.emoji, { ...reaction, count, mine: false });
    }
  }

  const target = next.get(emoji);
  if (target === undefined) {
    next.set(emoji, { emoji, count: 1, mine: true });
  } else if (!target.mine) {
    next.set(emoji, { ...target, count: target.count + 1, mine: true });
  }

  // Loudest first, ties broken by the curated emoji order, so the row is
  // stable across renders and re-renders.
  return Array.from(next.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    const aIndex = REACTION_EMOJI_INDEX.get(a.emoji) ?? REACTION_EMOJI_INDEX.size;
    const bIndex = REACTION_EMOJI_INDEX.get(b.emoji) ?? REACTION_EMOJI_INDEX.size;
    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    return a.emoji.localeCompare(b.emoji);
  });
}

/** Counts the chips flagged `mine` — the P0 invariant is "at most one". */
export function countMinePills(reactions: readonly ReactionSummary[]): number {
  return reactions.filter((reaction) => reaction.mine).length;
}

export function ReactionPicker({
  kudos,
  onKudosChange,
  onUnauthenticated,
  className,
}: ReactionPickerProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const menuId = `reaction-menu-${uid}`;
  const hintId = `reaction-hint-${uid}`;

  const [reactions, setReactions] = useState<ReactionSummary[]>(() =>
    normalizeReactions(kudos.reactions),
  );
  const [open, setOpen] = useState(false);
  const [updatingEmoji, setUpdatingEmoji] = useState<ReactionEmoji | null>(null);
  const [failedEmoji, setFailedEmoji] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Which `kudos.reactions` payload the row already reflects. A new array
  // reference means the parent handed us a genuinely new payload (a poll merge
  // or the kudos it just got back from `onKudosChange`) — whereas the *same*
  // reference after a pick means nothing new arrived, and the reconciled row
  // must be left alone rather than reset to the pre-pick truth.
  const appliedServerRef = useRef<readonly ReactionSummary[] | null>(
    kudos.reactions,
  );
  // A payload that arrived while a PUT was in flight, applied once it lands.
  const deferredServerRef = useRef<ReactionSummary[] | null>(null);

  useEffect(() => {
    if (kudos.reactions === appliedServerRef.current) {
      return;
    }
    appliedServerRef.current = kudos.reactions;

    if (updatingEmoji !== null) {
      // Mid-flight: the optimistic row is the truth until the 2xx reconciles.
      deferredServerRef.current = normalizeReactions(kudos.reactions);
      return;
    }
    setReactions(normalizeReactions(kudos.reactions));
  }, [kudos.reactions, updatingEmoji]);

  // Flush anything that arrived mid-flight once the pick settles.
  useEffect(() => {
    if (updatingEmoji !== null || deferredServerRef.current === null) {
      return;
    }
    const deferred = deferredServerRef.current;
    deferredServerRef.current = null;
    setReactions(deferred);
  }, [updatingEmoji]);

  const closePopover = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus && triggerRef.current !== null) {
      triggerRef.current.focus();
    }
  }, []);

  const submit = useCallback(
    async (emoji: ReactionEmoji) => {
      if (updatingEmoji !== null) {
        return;
      }

      const snapshot: ReactionsSnapshot = reactions;
      setFailedEmoji(null);
      setUpdatingEmoji(emoji);
      // The popover closes on pick and focus returns to the trigger, so a
      // keyboard user is never left holding focus on a button that unmounts.
      setOpen(false);
      setReactions(applyOptimisticReaction(snapshot, emoji));
      if (triggerRef.current !== null) {
        triggerRef.current.focus();
      }

      try {
        const updated = await setReaction(kudos.id, emoji);
        // Reconcile with the 2xx body: `preferredEmoji` keeps the emoji just
        // submitted as the mine pill, should a malformed payload ever claim two.
        const reconciled = normalizeReactions(updated.reactions, emoji);
        deferredServerRef.current = null;
        setReactions(reconciled);
        onKudosChange?.({ ...updated, reactions: reconciled });
      } catch (cause) {
        // Revert first, then explain — the chip row snaps back to the pre-pick
        // truth while the toast says why.
        setReactions([...snapshot]);
        setFailedEmoji(emoji);
        toast.error("Couldn't save that reaction");
        if (cause instanceof ApiError && cause.isUnauthenticated) {
          onUnauthenticated?.();
        }
      } finally {
        setUpdatingEmoji(null);
      }
    },
    [kudos.id, onKudosChange, onUnauthenticated, reactions, updatingEmoji],
  );

  const countFor = useCallback(
    (emoji: string): number =>
      reactions.find((reaction) => reaction.emoji === emoji)?.count ?? 0,
    [reactions],
  );

  const mineEmoji = useMemo(
    () => reactions.find((reaction) => reaction.mine)?.emoji ?? null,
    [reactions],
  );

  const state: ReactionPickerState =
    updatingEmoji !== null ? "selecting" : open ? "open" : "closed";

  /** Roving-focus keydown handler for the four emoji options. */
  function handleOptionKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
    emoji: ReactionEmoji,
  ) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown": {
        event.preventDefault();
        const nextIndex = (index + 1) % REACTION_EMOJIS.length;
        setFocusIndex(nextIndex);
        optionRefs.current[nextIndex]?.focus();
        return;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        event.preventDefault();
        const prevIndex =
          (index - 1 + REACTION_EMOJIS.length) % REACTION_EMOJIS.length;
        setFocusIndex(prevIndex);
        optionRefs.current[prevIndex]?.focus();
        return;
      }
      case "Home": {
        event.preventDefault();
        setFocusIndex(0);
        optionRefs.current[0]?.focus();
        return;
      }
      case "End": {
        event.preventDefault();
        const lastIndex = REACTION_EMOJIS.length - 1;
        setFocusIndex(lastIndex);
        optionRefs.current[lastIndex]?.focus();
        return;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        void submit(emoji);
        return;
      }
      case "Escape": {
        event.preventDefault();
        event.stopPropagation();
        closePopover(true);
        return;
      }
      case "Tab": {
        closePopover(false);
        return;
      }
      default:
        return;
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: REACTION_CHIP_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: REACTION_PICKER_CSS }} />

      <div
        data-component="reaction-picker"
        data-state={state}
        data-kudos-id={kudos.id}
        data-mine-count={countMinePills(reactions)}
        className={cn("relative", className)}
      >
        <ul data-testid="reaction-chip-row" className={ROW_CLASSES}>
          {reactions.map((reaction) => (
            <li key={reaction.emoji} className="contents">
              <ReactionChip
                reaction={reaction}
                updating={updatingEmoji === reaction.emoji}
                failed={failedEmoji === reaction.emoji && updatingEmoji === null}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={() => {
                  // Tapping an existing chip reacts with that emoji — even the
                  // amber mine pill, because EP-5 replaces rather than toggles.
                  if (isCuratedReaction(reaction.emoji)) {
                    void submit(reaction.emoji);
                  } else {
                    setFocusIndex(0);
                    setOpen(true);
                  }
                }}
              />
            </li>
          ))}

          <li className="contents">
            <button
              ref={triggerRef}
              type="button"
              data-testid="reaction-trigger"
              data-state={state}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={open ? menuId : undefined}
              onClick={() => {
                setFailedEmoji(null);
                setFocusIndex(0);
                setOpen((current) => !current);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setFocusIndex(0);
                  setOpen(true);
                }
              }}
              className={cn(
                "inline-flex select-none items-center gap-1.5 rounded-pill",
                "type-body-s border border-dashed border-border bg-transparent",
                "px-2.5 py-1 font-medium leading-none text-muted-foreground",
                "transition duration-fast ease-enter",
                "hover:border-accent hover:bg-accent-soft hover:text-foreground",
                "active:scale-[0.97]",
                FOCUS_CLASSES,
                "motion-reduce:animate-none",
              )}
            >
              <span aria-hidden="true" className="text-[15px] leading-none">
                ＋
              </span>
              {REACTION_TRIGGER_LABEL}
            </button>
          </li>
        </ul>

        {open ? (
          <div
            id={menuId}
            role="menu"
            aria-label={`React to ${kudos.recipient}'s kudos`}
            data-testid="reaction-picker-popover"
            data-state={state}
            className="reaction-picker__popover"
          >
            <div className="reaction-picker__options" role="group">
              {REACTION_EMOJIS.map((emoji, index) => {
                const mine = mineEmoji === emoji;
                const count = countFor(emoji);
                return (
                  <button
                    key={emoji}
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={mine}
                    data-mine={mine ? "true" : "false"}
                    data-count={count}
                    data-testid={`reaction-option-${emoji}`}
                    tabIndex={index === focusIndex ? 0 : -1}
                    aria-label={`React ${emoji} — ${REACTION_EMOJI_NAMES[emoji]}${
                      mine ? " — your reaction" : ""
                    }`}
                    onFocus={() => setFocusIndex(index)}
                    onKeyDown={(event) =>
                      handleOptionKeyDown(event, index, emoji)
                    }
                    onClick={() => void submit(emoji)}
                    className="reaction-picker__option"
                  >
                    <span aria-hidden="true">{emoji}</span>
                    <span aria-hidden="true" className="reaction-picker__check">
                      ✓
                    </span>
                  </button>
                );
              })}
            </div>
            <p id={hintId} className="type-caption text-muted-foreground">
              {REACTION_PICKER_HINT}
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}

export default ReactionPicker;
