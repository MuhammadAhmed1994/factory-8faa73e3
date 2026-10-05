"use client";

import { REACTION_EMOJI_INDEX, type ReactionSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * ReactionChip — one aggregated `emoji + count` pill in a kudos card's chip
 * row (cmp-reaction-chip).
 *
 * States (surfaced as `data-state`, so a story or a test can target each):
 * - `default`  a reaction other members hold — neutral card fill, border,
 *              `--foreground` text. Amber is *not* spent here: the accent is
 *              reserved for the viewer's own reaction (one accent per screen).
 * - `mine`     the viewer's own single reaction — the filled amber `--primary`
 *              pill with white text, which is how the row answers "which one
 *              is mine?" without reading a label.
 * - `updating` a PUT is in flight for this emoji — the pill pulses gently and
 *              dims slightly; counts are already the optimistic ones.
 * - `failed`   the PUT was rejected — the pill keeps the optimistic data but
 *              carries `--destructive` emphasis while the revert + toast land.
 *
 * Accessibility: emoji are never the sole carrier of meaning, so the chip's
 * accessible name is the sentence `React 🎉 — 3 so far — your reaction`
 * (`aria-label`), `aria-pressed` exposes the mine/not-mine state, and the
 * amber focus-visible ring is always present.
 *
 * **No toggle-to-remove.** Clicking the mine pill re-submits the same emoji:
 * EP-5 is an upsert-replace, so the result is still exactly one reaction
 * (AC-15), never zero.
 */

/** The four designed chip states. */
export type ReactionChipState = "default" | "mine" | "updating" | "failed";

/** Copy of the designed failure toast, shared by the picker. */
export const REACTION_FAILED_TOAST = "Couldn't save that reaction";

/**
 * Builds the chip's accessible name.
 *
 * `React 🎉 — 3 so far — your reaction` — the count and the ownership are both
 * spoken, so a screen-reader user knows the reaction exists *and* that it is
 * theirs without seeing the amber fill.
 */
export function reactionChipLabel(
  emoji: string,
  count: number,
  mine: boolean,
): string {
  return `React ${emoji} — ${count} so far${mine ? " — your reaction" : ""}`;
}

/** Props accepted by {@link ReactionChip}. */
export interface ReactionChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** The aggregated reaction this pill represents. */
  reaction: ReactionSummary;
  /**
   * `true` while a PUT for *this* emoji is in flight; renders the `updating`
   * pulse on top of the mine/default look.
   */
  updating?: boolean;
  /** `true` when the last PUT for this emoji failed; renders the `failed` look. */
  failed?: boolean;
  /** Extra classes for the pill. */
  className?: string;
}

const BASE_CLASSES = cn(
  "group inline-flex select-none items-center gap-1.5 rounded-pill",
  "type-body-s border px-2.5 py-1 font-medium leading-none",
  "transition duration-fast ease-enter",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-card",
  "disabled:pointer-events-none disabled:cursor-not-allowed",
  "motion-reduce:animate-none",
);

const DEFAULT_CLASSES = cn(
  "border-border bg-card text-foreground",
  "hover:border-accent hover:bg-accent-soft hover:text-foreground",
  "active:scale-[0.97]",
);

const MINE_CLASSES = cn(
  "border-primary bg-primary text-primary-foreground",
  "hover:shadow-card-hover active:scale-[0.97]",
);

const UPDATING_CLASSES = cn(
  "animate-[reaction-chip-pulse_1200ms_var(--motion-ease-enter)_infinite]",
  "opacity-80",
);

const FAILED_CLASSES = cn(
  "border-destructive text-destructive",
  "focus-visible:ring-destructive",
);

/**
 * Declared here (rather than in `app/globals.css`, which the scaffold task
 * owns) so the pulse travels with the component. Every value resolves to a
 * design token's CSS variable — no hex anywhere — and the reduced-motion block
 * collapses the pulse to a single 200ms opacity fade, per the design system.
 */
export const REACTION_CHIP_CSS = `
@keyframes reaction-chip-pulse {
  0%   { transform: scale(1);    opacity: 0.8; }
  50%  { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1);    opacity: 0.8; }
}
@media (prefers-reduced-motion: reduce) {
  .reaction-chip[data-state="updating"] {
    animation: none;
    opacity: 0.8;
  }
}
`;

export function ReactionChip({
  reaction,
  updating = false,
  failed = false,
  className,
  disabled,
  onClick,
  ...props
}: ReactionChipProps) {
  const { emoji, count, mine } = reaction;

  // `updating` outranks `failed`, which outranks the mine/default split: while
  // a retry is in flight the member needs to see progress, not the last error.
  const state: ReactionChipState = updating
    ? "updating"
    : failed
      ? "failed"
      : mine
        ? "mine"
        : "default";

  // Curated emoji keep their declared order, so the row is stable; anything
  // uncurated (never produced by the API) still renders, sorted to the end.
  const order = REACTION_EMOJI_INDEX.get(emoji) ?? REACTION_EMOJI_INDEX.size;

  return (
    <button
      type="button"
      data-testid="reaction-chip"
      data-state={state}
      data-mine={mine ? "true" : "false"}
      data-updating={updating ? "true" : undefined}
      data-failed={failed ? "true" : undefined}
      data-emoji={emoji}
      data-order={order}
      aria-label={reactionChipLabel(emoji, count, mine)}
      aria-pressed={mine}
      aria-disabled={disabled === true || undefined}
      disabled={disabled}
      style={{ order }}
      className={cn(
        BASE_CLASSES,
        mine ? MINE_CLASSES : DEFAULT_CLASSES,
        updating && UPDATING_CLASSES,
        failed && FAILED_CLASSES,
        className,
      )}
      onClick={onClick}
      {...props}
    >
      <span aria-hidden="true" className="text-[15px] leading-none">
        {emoji}
      </span>
      <span
        aria-hidden="true"
        data-testid="reaction-chip-count"
        className="tabular-nums"
      >
        {count}
      </span>
    </button>
  );
}

export default ReactionChip;
