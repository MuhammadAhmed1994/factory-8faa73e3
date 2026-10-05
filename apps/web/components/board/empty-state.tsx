import { HIDDEN_EMPTY_MESSAGE } from "@/lib/api/moderation";
import { cn } from "@/lib/utils";

/**
 * EmptyState — the designed "nothing here yet" moment of the board
 * (cmp-empty-state).
 *
 * Two variants, both pinned by the UX copy:
 *
 * | variant         | headline                                              | when                    |
 * |-----------------|-------------------------------------------------------|-------------------------|
 * | `board-empty`   | "No kudos yet — be the first to say thanks."          | page 1 has no kudos     |
 * | `hidden-empty`  | "Nothing hidden. The board is a nice place today."    | lead's "Hidden only" view is empty |
 *
 * The illustration stays **typographic** (a large 🎉 in display type) — no stock
 * art, per the design system. Every state is designed, and the empty board is
 * the product's first impression: the composer stays above it so the very next
 * action is one field away.
 *
 * `role="status"` announces the state politely without stealing focus, and the
 * headline is an `h2` so the page keeps its logical heading order (h1 "Team
 * Kudos" → the composer's h2 → this h2).
 */

/** The two designed variants. */
export type EmptyStateVariant = "board-empty" | "hidden-empty";

/** Copy of the empty shared wall (scr-board, "empty board" state). */
export const BOARD_EMPTY_MESSAGE = "No kudos yet — be the first to say thanks.";

/** Helper line under the board-empty headline. */
export const BOARD_EMPTY_HELPER =
  "Say thanks in 280 characters or less — the wall fills up from here.";

/** Helper line under the hidden-empty headline. */
export const HIDDEN_EMPTY_HELPER =
  "Kudos hidden from the board are collected here for leads.";

/** Typographic glyph per variant — never the sole carrier of meaning. */
const GLYPHS: Record<EmptyStateVariant, string> = {
  "board-empty": "🎉",
  "hidden-empty": "🌤️",
};

const HEADLINES: Record<EmptyStateVariant, string> = {
  "board-empty": BOARD_EMPTY_MESSAGE,
  "hidden-empty": HIDDEN_EMPTY_MESSAGE,
};

const HELPERS: Record<EmptyStateVariant, string> = {
  "board-empty": BOARD_EMPTY_HELPER,
  "hidden-empty": HIDDEN_EMPTY_HELPER,
};

/** The designed headline for a variant, exported for reuse in specs/copy. */
export function emptyStateHeadline(variant: EmptyStateVariant): string {
  return HEADLINES[variant];
}

/** Props accepted by {@link EmptyState}. */
export interface EmptyStateProps {
  /** Which empty moment this is; defaults to `board-empty`. */
  variant?: EmptyStateVariant;
  /** Extra classes for the card. */
  className?: string;
}

export function EmptyState({ variant = "board-empty", className }: EmptyStateProps) {
  return (
    <div
      role="status"
      data-testid={variant}
      data-variant={variant}
      className={cn(
        "rounded-card border border-dashed border-border bg-card px-6 py-12 text-center shadow-card",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="type-display block leading-none"
        data-testid="empty-state-glyph"
      >
        {GLYPHS[variant]}
      </span>
      <h2 className="type-display font-heading mt-4 font-extrabold">
        {HEADLINES[variant]}
      </h2>
      <p className="type-body-s mx-auto mt-3 max-w-[46ch] text-muted-foreground">
        {HELPERS[variant]}
      </p>
    </div>
  );
}

export default EmptyState;
