/**
 * Shared kudos/reaction API types (ADR-7 resource + ADR-4 curated emoji set).
 *
 * This module is the *contract* module for the board's reaction UI: the ADR-7
 * kudos resource every endpoint answers with, plus the fixed four-emoji set
 * Q-3 recommends and ADR-4 locks in. `lib/api-client.ts` declares structurally
 * identical resource shapes for its own helpers — the two are interchangeable
 * under TypeScript's structural typing, so callers may import either; new code
 * should import from here so the contract has one obvious home.
 */

/**
 * The member who posted a kudos, embedded in every kudos response (ADR-7).
 *
 * Only `id` and `email` ever leave the API — never a password hash.
 */
export interface KudosAuthor {
  readonly id: string;
  readonly email: string;
}

/**
 * One aggregated reaction row on a kudos (ADR-7).
 *
 * `mine` tells the board which pill belongs to the caller without an extra
 * round-trip, which is exactly what the picker needs to move the single
 * "your reaction" pill between emojis (AC-14 / AC-15).
 */
export interface ReactionSummary {
  /** One of {@link REACTION_EMOJI_SET} — the API rejects anything else with 400. */
  readonly emoji: string;
  /** How many members reacted with this emoji (AC-16). */
  readonly count: number;
  /** True when the caller's own reaction is this emoji. At most one row is `mine`. */
  readonly mine: boolean;
}

/**
 * The uniform kudos resource returned by list, create and react (ADR-7):
 * `{ id, recipient, message, author { id, email }, createdAt, reactions }`.
 *
 * Hidden state is never exposed and there are no per-kudos detail endpoints —
 * everything the board renders is in this one shape.
 */
export interface Kudos {
  readonly id: string;
  readonly recipient: string;
  readonly message: string;
  readonly author: KudosAuthor;
  /** ISO-8601 timestamp; the board renders it relative. */
  readonly createdAt: string;
  /** Aggregated reactions, one row per emoji that at least one member picked. */
  readonly reactions: readonly ReactionSummary[];
}

/**
 * The curated emoji characters as they travel on the wire (ADR-4).
 *
 * Written with escape sequences on purpose — exactly as the API's
 * `set-reaction.dto.ts` spells them — because the heart is U+2764 followed by
 * the **invisible** variation selector U+FE0F, which an editor can silently
 * strip and a copy/paste can just as silently keep. Spelling the code points
 * out keeps this set byte-exact against the API's `@IsIn` validation, so a
 * heart submitted from the picker can never be rejected as "not curated".
 */
export const THUMBS_UP_EMOJI = "\u{1F44D}"; // 👍
export const HEART_EMOJI = "\u2764\uFE0F"; // ❤️
export const TADA_EMOJI = "\u{1F389}"; // 🎉
export const RAISED_HANDS_EMOJI = "\u{1F64C}"; // 🙌

/**
 * The fixed curated reaction set (Q-3 recommended, ADR-4): 👍 ❤️ 🎉 🙌.
 *
 * Rendered as text emoji — no icon font, no image sprites — so the emoji
 * themselves carry the colour while the surrounding UI stays neutral. The API
 * validates `PUT /kudos/:id/reactions` against exactly these four and answers
 * 400 for anything else, which is why the client can rely on the tuple both for
 * rendering the picker and for pre-flight validation.
 */
export const REACTION_EMOJI_SET = [
  THUMBS_UP_EMOJI,
  HEART_EMOJI,
  TADA_EMOJI,
  RAISED_HANDS_EMOJI,
] as const;

/** A member-submittable emoji: one of {@link REACTION_EMOJI_SET}. */
export type ReactionEmoji = (typeof REACTION_EMOJI_SET)[number];

/**
 * Narrows an arbitrary value (a chip's emoji straight off a JSON body, say) to
 * {@link ReactionEmoji}.
 *
 * Note that `❤️` is `U+2764 U+FE0F` — the variation selector is part of the
 * string, so a bare `❤` (U+2764) is *not* a member of the set.
 */
export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return (
    typeof value === "string" &&
    (REACTION_EMOJI_SET as readonly string[]).includes(value)
  );
}
