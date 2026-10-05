/**
 * EmptyState (`cmp-empty-state`) — the two designed empty variants of the board.
 *
 * Every state is designed, and the empty board is the product's first
 * impression: the illustration stays typographic (a large 🎉 in display type)
 * because the emoji and the words carry the warmth — no stock art, no icon
 * sprites. The composer stays above the wall either way, so "be the first to
 * say thanks" is one field away.
 *
 * Variants (surfaced as `data-empty`):
 *
 * - `board-empty`  the visible board has no kudos yet.
 * - `hidden-empty` a lead flipped `Hidden only` and nothing is soft-hidden —
 *                  the board is a nice place today.
 *
 * A Server Component by shape (no state, no handlers); it renders inside the
 * board's client island, which is what decides *which* variant to show.
 */

import { cn } from "@/components/ui/cn";

/** The visible board's empty copy (scr-board · empty board). */
export const BOARD_EMPTY_MESSAGE =
  "No kudos yet — be the first to say thanks.";

/** The lead-only hidden view's empty copy (scr-board-lead · hidden-empty). */
export const HIDDEN_EMPTY_MESSAGE =
  "Nothing hidden. The board is a nice place today.";

/** Helper under the board-empty headline, pointing at the composer above it. */
export const BOARD_EMPTY_HINT =
  "Say thanks in 280 characters or less — new kudos appear automatically.";

/** Helper under the hidden-empty headline. */
export const HIDDEN_EMPTY_HINT = "Hidden kudos stay visible to leads only.";

/** The two designed variants. */
export type EmptyStateVariant = "board-empty" | "hidden-empty";

/** Props for {@link EmptyState}. */
export interface EmptyStateProps {
  /** Defaults to `board-empty`. */
  readonly variant?: EmptyStateVariant;
  /** Extra class names appended after the state's own. */
  readonly className?: string;
}

/** Copy for one variant: the headline plus its helper line. */
function copyFor(variant: EmptyStateVariant): {
  readonly headline: string;
  readonly hint: string;
} {
  return variant === "hidden-empty"
    ? { headline: HIDDEN_EMPTY_MESSAGE, hint: HIDDEN_EMPTY_HINT }
    : { headline: BOARD_EMPTY_MESSAGE, hint: BOARD_EMPTY_HINT };
}

/**
 * One empty variant: the typographic glyph, the headline in display type and a
 * quiet helper line, on a card surface so it reads as part of the wall.
 */
export function EmptyState({
  variant = "board-empty",
  className,
}: EmptyStateProps) {
  const { headline, hint } = copyFor(variant);

  return (
    <div
      data-empty={variant}
      data-testid={`board-empty-${variant}`}
      className={cn(
        "rounded-card border border-border bg-card px-6 py-12 text-center shadow-card",
        className,
      )}
    >
      <p aria-hidden="true" className="font-heading text-display leading-none">
        🎉
      </p>
      <p className="mt-4 font-heading text-heading-m text-foreground">
        {headline}
      </p>
      <p className="mx-auto mt-2 max-w-[46ch] text-caption text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

export default EmptyState;
