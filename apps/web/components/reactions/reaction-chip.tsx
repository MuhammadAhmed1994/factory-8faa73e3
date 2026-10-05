"use client";

import type { ReactNode } from "react";
import { cn, FOCUS_RING } from "../../components/ui/cn";

/**
 * ReactionChip (`cmp-reaction-chip`) — one aggregated emoji + count pill.
 *
 * Presentational by design: the picker owns the request and the optimistic
 * state, the chip only renders what it is handed. Four states are designed and
 * surfaced on the element as `data-state`:
 *
 * - `default`   neutral pill on the card — an emoji other members chose.
 * - `mine`      the filled amber pill (`--primary`, #B45309): the viewer's own
 *               reaction. Exactly one pill on a kudos is ever `mine` (C-4/ADR-4).
 * - `updating`  an optimistic pick is in flight — the pill pulses and its count
 *               is marked busy so the member sees the request was accepted
 *               before the server answers; the digit itself stays visible.
 * - `failed`    the optimistic pick was rolled back — destructive ring, plus
 *               `aria-live="polite"` so the miss is announced once.
 *
 * Every interactive element keeps the amber focus-visible ring (a11y
 * requirement) and every chip carries a full `aria-label`, because an emoji is
 * never the sole carrier of meaning:
 * `React 🎉 — 3 so far — your reaction`.
 */

/** Copy appended to the accessible name of the viewer's own pill. */
export const MINE_LABEL = "your reaction";

/** Copy appended to the accessible name of every other pill. */
export const OTHERS_LABEL = "not yours yet";

/** Visually-hidden text announced while an optimistic pick is in flight. */
export const UPDATING_LABEL = "Saving your reaction";

/** Copy announced when an optimistic pick has been rolled back. */
export const FAILED_LABEL = "Reaction not saved";

/**
 * Builds the chip's accessible name.
 *
 * The count is always part of the name so a screen reader hears the total even
 * though the visible digit is a separate visual token, and the trailing clause
 * disambiguates the viewer's own pill from everyone else's without relying on
 * colour alone.
 */
export function reactionChipLabel(
  emoji: string,
  count: number,
  mine: boolean,
): string {
  return `React ${emoji} — ${count} so far — ${mine ? MINE_LABEL : OTHERS_LABEL}`;
}

/** The four designed states of {@link ReactionChip}. */
export type ReactionChipState = "default" | "mine" | "updating" | "failed";

/** Props for {@link ReactionChip}. */
export interface ReactionChipProps {
  /** The aggregated emoji this pill represents. */
  readonly emoji: string;
  /** How many members have picked this emoji. */
  readonly count: number;
  /** True when this emoji is the viewer's own reaction. */
  readonly mine: boolean;
  /** Marks the pill as the viewer's own — the filled amber pill. Defaults from `mine`. */
  readonly state?: ReactionChipState;
  /**
   * Fires on activation. Chips are `type="button"` so they never submit a
   * surrounding form. The picker decides what a click means (open the popover /
   * move the mine pill); the chip itself is stateless.
   */
  readonly onSelect?: () => void;
  /** Disables pointer/keyboard activation while a pick is in flight. */
  readonly disabled?: boolean;
  /** Extra class names for the button. */
  readonly className?: string;
  /** Visually-hidden extra description, appended after the accessible name. */
  readonly srDescription?: ReactNode;
}

/**
 * One reaction pill.
 *
 * The count is a separate `<span>` with `font-variant-numeric: tabular-nums`
 * (body_s per the type scale) so digits do not jitter as they reconcile; the
 * emoji itself is `aria-hidden` because the button's accessible name already
 * spells it out.
 */
export function ReactionChip({
  emoji,
  count,
  mine,
  state = mine ? "mine" : "default",
  onSelect,
  disabled = false,
  className,
  srDescription,
}: ReactionChipProps) {
  const label = reactionChipLabel(emoji, count, mine);
  const isMine = mine || state === "mine";

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      data-state={state}
      data-mine={isMine ? "true" : "false"}
      data-testid={`reaction-chip-${emoji}`}
      aria-label={label}
      aria-pressed={isMine || undefined}
      aria-busy={state === "updating" || undefined}
      {...(state === "failed" ? { "aria-live": "polite" as const } : {})}
      className={cn(
        "inline-flex select-none items-center gap-1 rounded-pill border px-2.5 py-1",
        "text-body-s font-medium transition duration-base ease-enter",
        FOCUS_RING,
        "disabled:pointer-events-none disabled:opacity-60",
        isMine
          ? "border-primary bg-primary text-primary-foreground shadow-card"
          : "border-border bg-card text-foreground hover:border-muted-foreground/40 hover:bg-muted",
        state === "updating" && "animate-pulse",
        state === "failed" && "border-destructive ring-1 ring-destructive",
        className,
      )}
    >
      <span aria-hidden="true" className="text-[15px] leading-none">
        {emoji}
      </span>
      <span className="tabular-nums">{count}</span>
      {state === "updating" ? (
        <span className="sr-only">{UPDATING_LABEL}</span>
      ) : null}
      {state === "failed" ? (
        <span className="sr-only">{FAILED_LABEL}</span>
      ) : null}
      {srDescription ? (
        <span className="sr-only">{srDescription}</span>
      ) : null}
    </button>
  );
}

export default ReactionChip;
