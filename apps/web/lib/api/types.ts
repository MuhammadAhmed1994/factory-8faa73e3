/**
 * Shared kudos / reaction API types for the web app (ADR-7 + ADR-4 / Q-3).
 *
 * This module is the **browser-side mirror of the API's resource contract**:
 *
 * ```json
 * {
 *   "id": "ckudos-1",
 *   "recipient": "priya@team.co",
 *   "message": "Shipped the migration on a Friday.",
 *   "author": { "id": "member-1", "email": "maya@team.co" },
 *   "createdAt": "2024-05-01T10:00:00.000Z",
 *   "reactions": [{ "emoji": "🎉", "count": 3, "mine": true }]
 * }
 * ```
 *
 * `reactions` is the read-time aggregate every endpoint returns (never the raw
 * `Reaction` rows): one summary per emoji, `count` grouped across members and
 * `mine` flagging the **caller's** single reaction, which is all the reaction
 * UI needs without an extra round trip (ADR-7 rationale).
 *
 * The names here are the domain names of the spec (`Kudos`, `ReactionSummary`);
 * `lib/api-client.ts` describes the same wire shape under its own aliases, and
 * the two stay interchangeable because both are plain structural interfaces.
 */

/**
 * The fixed curated reaction set — 👍 ❤️ 🎉 🙌 (Q-3 recommended option, ADR-4).
 *
 * `as const` makes this a readonly tuple, so `ReactionEmoji` is exactly the
 * four-character union the API's `@IsIn` accepts; any other emoji is a client
 * side 400 before a request is ever sent.
 */
export const REACTION_EMOJIS = ["👍", "❤️", "🎉", "🙌"] as const;

/** One of the four curated emoji characters. */
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/** Readable names, so an emoji is never the sole carrier of meaning. */
export const REACTION_EMOJI_NAMES: Readonly<Record<ReactionEmoji, string>> = {
  "👍": "thumbs up",
  "❤️": "heart",
  "🎉": "party popper",
  "🙌": "raised hands",
};

/**
 * emoji → position in the curated order, for deterministic chip ordering.
 *
 * A `Map` (rather than `includes`) keeps the lookup O(1) for the picker, which
 * asks "is this curated?" on every pick.
 */
export const REACTION_EMOJI_INDEX: ReadonlyMap<string, number> = new Map(
  REACTION_EMOJIS.map((emoji, index) => [emoji, index] as const),
);

/** Type guard: `true` only for one of the four curated characters. */
export function isCuratedReaction(value: string): value is ReactionEmoji {
  return REACTION_EMOJI_INDEX.has(value);
}

/** `author { id, email }` on the uniform kudos resource (ADR-7). */
export interface KudosAuthor {
  id: string;
  email: string;
}

/**
 * One aggregated reaction on a kudos (ADR-4 / ADR-7).
 *
 * `mine` is `true` for at most **one** summary per kudos — the caller's single
 * reaction (constraint C-4) — which is exactly the invariant the reaction UI
 * renders as the amber pill.
 */
export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

/** The uniform kudos resource returned by list, create **and** react (ADR-7). */
export interface Kudos {
  id: string;
  recipient: string;
  message: string;
  author: KudosAuthor;
  createdAt: string;
  reactions: ReactionSummary[];
}

/** The viewer's own reaction summary, or `null` when they have not reacted. */
export function findMineReaction(
  reactions: readonly ReactionSummary[],
): ReactionSummary | null {
  return reactions.find((reaction) => reaction.mine) ?? null;
}

/**
 * Orders summaries the way the board shows them: loudest first (count desc),
 * ties broken by the curated emoji order and finally by the emoji itself, so
 * the chip row is stable across renders and identical to the API's ordering.
 */
export function sortReactionSummaries(
  reactions: readonly ReactionSummary[],
): ReactionSummary[] {
  return [...reactions].sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    const aIndex = REACTION_EMOJI_INDEX.get(a.emoji) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = REACTION_EMOJI_INDEX.get(b.emoji) ?? Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    return a.emoji.localeCompare(b.emoji);
  });
}

/**
 * Defensive guard for the P0 invariant: at most one summary may be `mine`.
 *
 * The API guarantees this (the unique `(kudosId, memberId)` pair behind
 * EP-5 makes the reaction an upsert, never an insert), so in practice this is
 * a no-op. If a payload ever claimed two `mine` reactions, the one matching
 * `preferredEmoji` — the emoji just submitted — wins, otherwise the first;
 * every other claim is demoted. Counts are aggregates and stay untouched, so
 * the demotion can never invent or lose a reaction.
 */
export function ensureSingleMine(
  reactions: readonly ReactionSummary[],
  preferredEmoji?: string,
): ReactionSummary[] {
  const mineIndexes = reactions
    .map((reaction, index) => (reaction.mine ? index : -1))
    .filter((index) => index >= 0);

  if (mineIndexes.length <= 1) {
    return [...reactions];
  }

  const preferred =
    preferredEmoji === undefined
      ? -1
      : reactions.findIndex(
          (reaction) => reaction.mine && reaction.emoji === preferredEmoji,
        );
  const firstMine = mineIndexes[0] ?? -1;
  const chosen = preferred >= 0 ? preferred : firstMine;
  if (chosen < 0) {
    return [...reactions];
  }

  return reactions.map((reaction, index) =>
    reaction.mine && index !== chosen ? { ...reaction, mine: false } : reaction,
  );
}

/**
 * Normalises a `reactions` array off the wire into what the chip row renders.
 *
 * - Non-array / malformed entries are dropped rather than crashing the board.
 * - Zero-count summaries are dropped: an aggregate nobody holds is not a chip.
 * - At most one entry survives as `mine` ({@link ensureSingleMine}).
 * - Ordering is {@link sortReactionSummaries}.
 */
export function normalizeReactions(
  input: unknown,
  preferredEmoji?: string,
): ReactionSummary[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const summaries: ReactionSummary[] = [];
  for (const entry of input) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { emoji, count, mine } = entry as {
      emoji?: unknown;
      count?: unknown;
      mine?: unknown;
    };
    if (typeof emoji !== "string" || emoji.length === 0) {
      continue;
    }
    const safeCount =
      typeof count === "number" && Number.isFinite(count) && count > 0
        ? Math.floor(count)
        : 0;
    if (safeCount === 0) {
      continue;
    }
    summaries.push({ emoji, count: safeCount, mine: mine === true });
  }

  return sortReactionSummaries(ensureSingleMine(summaries, preferredEmoji));
}
