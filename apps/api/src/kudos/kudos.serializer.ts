import { REACTION_EMOJIS } from "@/app.config";

/**
 * Serialiser for the uniform kudos resource (ADR-7).
 *
 * Every kudos-returning endpoint — list, create, and (later) react — emits
 * exactly this shape, so the board, the composer and the reaction picker all
 * read the same payload with no per-kudos detail round-trips:
 *
 * ```json
 * {
 *   "id": "…",
 *   "recipient": "thanked@team.co",
 *   "message": "…",
 *   "author": { "id": "…", "email": "author@team.co" },
 *   "createdAt": "2024-01-01T00:00:00.000Z",
 *   "reactions": [{ "emoji": "🎉", "count": 2, "mine": false }]
 * }
 * ```
 *
 * Notes on two deliberate choices:
 *
 * * `recipient` is a **flat string** (the thanked member's email) while
 *   `author` is nested `{ id, email }` — that asymmetry is spelled out by
 *   ADR-7 itself, and it is what the web client's `Kudos` type expects.
 * * Hidden state is never part of the standard shape. The lead-only review
 *   variant (`GET /api/v1/kudos?hidden=true`) opts in explicitly through
 *   {@link SerializeKudosOptions.withHiddenState}, which appends
 *   `hiddenAt`/`hiddenBy` on top of the standard shape.
 */

/** `author { id, email }` on the uniform kudos resource (ADR-7). */
export interface SerializedKudosAuthor {
  readonly id: string;
  readonly email: string;
}

/** Aggregated reaction, computed at read time (ADR-4 / ADR-7). */
export interface SerializedKudosReaction {
  readonly emoji: string;
  readonly count: number;
  /** Whether the calling member's own reaction is the one counted here. */
  readonly mine: boolean;
}

/** The uniform kudos resource returned by every kudos endpoint (ADR-7). */
export interface SerializedKudos {
  readonly id: string;
  readonly recipient: string;
  readonly message: string;
  readonly author: SerializedKudosAuthor;
  readonly createdAt: string;
  readonly reactions: readonly SerializedKudosReaction[];
}

/**
 * The lead-only review variant: the standard shape plus the soft-hide
 * bookkeeping (ADR-5). `hiddenBy` is `null` in v1 because `prisma/schema.prisma`
 * records only `hiddenAt` — there is no `hiddenById` column to read from.
 */
export interface SerializedKudosWithHiddenState extends SerializedKudos {
  readonly hiddenAt: string | null;
  readonly hiddenBy: string | null;
}

/** A reaction row, exactly as `KudosService` selects it for serialisation. */
export interface KudosReactionRow {
  readonly emoji: string;
  readonly memberId: string;
}

/** A kudos row joined with its author, recipient and reactions. */
export interface KudosRow {
  readonly id: string;
  readonly message: string;
  readonly createdAt: Date;
  readonly hiddenAt: Date | null;
  readonly author: SerializedKudosAuthor;
  readonly recipient: SerializedKudosAuthor;
  readonly reactions: readonly KudosReactionRow[];
}

/** Options accepted by {@link serializeKudos}. */
export interface SerializeKudosOptions {
  /** The member reading the resource; drives the `mine` flag. */
  readonly viewerId: string;
  /**
   * When `true`, appends `hiddenAt`/`hiddenBy` (lead-only review variant).
   * Defaults to `false`, which is the plain ADR-7 shape.
   */
  readonly withHiddenState?: boolean;
}

/**
 * Maps a `ReactionEmoji` enum value of `prisma/schema.prisma` onto the curated
 * emoji character the API speaks (ADR-4 / Q-3).
 */
const EMOJI_BY_ENUM_VALUE: Readonly<Record<string, string>> = {
  THUMBS_UP: "👍",
  HEART: "❤️",
  TADA: "🎉",
  RAISED_HANDS: "🙌",
};

/**
 * Renders one stored reaction value as the emoji the API exposes.
 *
 * A value that already *is* a curated character is passed through untouched, so
 * a future schema revision storing characters directly needs no change here and
 * no reaction is ever silently dropped or rewritten.
 */
const toEmoji = (stored: string): string => {
  const mapped = EMOJI_BY_ENUM_VALUE[stored];
  return mapped ?? stored;
};

/** ISO-8601 for a nullable timestamp, so `null` survives the JSON round trip. */
const toIsoOrNull = (value: Date | null | undefined): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
};

/**
 * Aggregates a kudos' raw reaction rows into the ADR-7 `reactions` array.
 *
 * Counts and `mine` are computed here, at read time — nothing is stored (see
 * the data-model note "no aggregates are stored"). Until the reactions module
 * lands, every kudos simply has no reaction rows, so this returns `[]`.
 *
 * The result is ordered by descending count, then emoji, so the payload is
 * deterministic for identical data.
 */
export const aggregateReactions = (
  reactions: readonly KudosReactionRow[] | undefined,
  viewerId: string,
): SerializedKudosReaction[] => {
  const grouped = new Map<string, { count: number; mine: boolean }>();

  for (const reaction of reactions ?? []) {
    const emoji = toEmoji(reaction.emoji);
    const current = grouped.get(emoji) ?? { count: 0, mine: false };
    current.count += 1;
    current.mine = current.mine || reaction.memberId === viewerId;
    grouped.set(emoji, current);
  }

  return [...grouped.entries()]
    .map(
      ([emoji, entry]): SerializedKudosReaction => ({
        emoji,
        count: entry.count,
        mine: entry.mine,
      }),
    )
    .sort(
      (left, right) =>
        right.count - left.count || left.emoji.localeCompare(right.emoji),
    );
};

/**
 * Projects one kudos row onto the uniform response shape.
 *
 * Returns {@link SerializedKudosWithHiddenState} when
 * `options.withHiddenState` is set (lead-only review variant), otherwise the
 * plain ADR-7 shape with no hidden state exposed.
 */
export const serializeKudos = (
  row: KudosRow,
  options: SerializeKudosOptions,
): SerializedKudos | SerializedKudosWithHiddenState => {
  const base: SerializedKudos = {
    id: row.id,
    recipient: row.recipient.email,
    message: row.message,
    author: { id: row.author.id, email: row.author.email },
    createdAt: toIsoOrNull(row.createdAt) as string,
    reactions: aggregateReactions(row.reactions, options.viewerId),
  };

  if (options.withHiddenState !== true) {
    return base;
  }

  return {
    ...base,
    hiddenAt: toIsoOrNull(row.hiddenAt),
    // `prisma/schema.prisma` records only `hiddenAt`; there is no `hiddenBy`
    // column in v1, so the review variant reports the absence honestly
    // rather than inventing an attribution.
    hiddenBy: null,
  };
};
