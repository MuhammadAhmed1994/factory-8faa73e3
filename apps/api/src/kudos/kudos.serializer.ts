import { KUDOS_PAGE_SIZE } from "./dto/create-kudos.dto";

/**
 * Serialisation of the kudos resource (ADR-7).
 *
 * Every kudos endpoint - list, create, and later react - answers with exactly
 * this shape, so the board renders a list item, a freshly posted card and a
 * reacted card identically without any client-side reshuffling:
 *
 * ```json
 * {
 *   "id": "ck...",
 *   "recipient": "colleague@kudos.local",
 *   "message": "Thank you for the pairing session!",
 *   "author": { "id": "ck...", "email": "member@kudos.local" },
 *   "createdAt": "2024-01-01T00:00:00.000Z",
 *   "reactions": [{ "emoji": "👍", "count": 1, "mine": true }]
 * }
 * ```
 *
 * Nothing else is ever emitted: no `passwordHash` (it is not even selected by
 * the service), no hidden flag on the public board (ADR-5/ADR-7), and no
 * per-kudos detail route exists.
 */

/**
 * The curated reaction set (ADR-4 / Q-3) as it is *stored*: the `ReactionEmoji`
 * Prisma enum of `prisma/schema.prisma`.
 *
 * Declared locally (a string union mirroring the enum) rather than imported
 * from `@prisma/client` so this pure module keeps compiling before
 * `prisma generate` has produced the client - the same trick `PrismaService`
 * and `prisma/seed.ts` use.
 */
export type ReactionEmojiValue = "THUMBS_UP" | "HEART" | "TADA" | "RAISED_HANDS";

/**
 * The emoji character each curated reaction is rendered with (ADR-4: the
 * reaction body is submitted as one of these four characters).
 */
export const REACTION_EMOJI_CHARS: Readonly<Record<ReactionEmojiValue, string>> =
  {
    THUMBS_UP: "👍",
    HEART: "❤️",
    TADA: "🎉",
    RAISED_HANDS: "🙌",
  };

/**
 * Maps a stored `ReactionEmoji` enum value to its emoji character, falling back
 * to the raw value if an unknown emoji ever reaches the serializer.
 */
export function reactionEmojiChar(emoji: string): string {
  return REACTION_EMOJI_CHARS[emoji as ReactionEmojiValue] ?? emoji;
}

/** Member reference embedded as `author` (ADR-7: `{ id, email }` - never a hash). */
export interface KudosMemberRef {
  readonly id: string;
  readonly email: string;
}

/**
 * One aggregated reaction on a kudos (ADR-7).
 *
 * `count` is the number of members who picked that emoji and `mine` tells the
 * caller whether *her/his* single reaction is one of them - everything the
 * reaction picker needs in one round-trip.
 */
export interface KudosReactionSummary {
  readonly emoji: string;
  readonly count: number;
  readonly mine: boolean;
}

/** The uniform kudos resource returned by every kudos endpoint (ADR-7). */
export interface SerializedKudos {
  readonly id: string;
  /** The thanked colleague, identified by her/his email. */
  readonly recipient: string;
  readonly message: string;
  readonly author: KudosMemberRef;
  /** ISO-8601 timestamp; the board sorts newest first on it (ADR-6). */
  readonly createdAt: string;
  readonly reactions: readonly KudosReactionSummary[];
}

/**
 * Lead-only review shape: the uniform resource plus the soft-hide audit fields
 * (ADR-5). Never returned by the public board response.
 */
export interface SerializedHiddenKudos extends SerializedKudos {
  /** ISO-8601 timestamp of the soft-hide; always present on this variant. */
  readonly hiddenAt: string;
  /**
   * Member id of who hid the kudos, when known.
   *
   * The T-2 schema records *when* (`Kudos.hiddenAt`) but not *who* - there is
   * no `hiddenBy` column yet - so this field is surfaced as `null` until a
   * moderation task adds that provenance. The key is always present so
   * consumers can rely on the shape.
   */
  readonly hiddenBy: string | null;
}

/**
 * The row slice the serializer needs.
 *
 * Structural on purpose: it matches what the service selects from Prisma
 * (`author`/`recipient` narrowed to `{ id, email }`) without importing the
 * generated client types.
 */
export interface KudosRow {
  readonly id: string;
  readonly message: string;
  readonly createdAt: Date;
  readonly hiddenAt: Date | null;
  readonly author: KudosMemberRef;
  readonly recipient: KudosMemberRef;
}

/** Re-exported for convenience so callers can state the page size (ADR-6). */
export { KUDOS_PAGE_SIZE };

/**
 * Serialises one kudos row into the uniform resource (ADR-7).
 *
 * `reactions` defaults to empty - the aggregates are computed at read time by
 * the service (nothing is stored), and stay empty until the reactions module
 * lands.
 */
export function serializeKudos(
  row: KudosRow,
  reactions: readonly KudosReactionSummary[] = [],
): SerializedKudos {
  return {
    id: row.id,
    recipient: row.recipient.email,
    message: row.message,
    author: { id: row.author.id, email: row.author.email },
    createdAt: row.createdAt.toISOString(),
    reactions: reactions.map((reaction) => ({
      emoji: reaction.emoji,
      count: reaction.count,
      mine: reaction.mine,
    })),
  };
}

/**
 * Serialises one kudos row into the lead-only review shape: the uniform
 * resource plus `hiddenAt`/`hiddenBy`.
 */
export function serializeHiddenKudos(
  row: KudosRow,
  reactions: readonly KudosReactionSummary[] = [],
): SerializedHiddenKudos {
  return {
    ...serializeKudos(row, reactions),
    hiddenAt: (row.hiddenAt ?? new Date(0)).toISOString(),
    hiddenBy: null,
  };
}

/**
 * Serialises a page of kudos rows, looking each row's reaction aggregates up in
 * `reactionsByKudosId`. Rows without an entry get `reactions: []`.
 */
export function serializeKudosList(
  rows: readonly KudosRow[],
  reactionsByKudosId: ReadonlyMap<string, readonly KudosReactionSummary[]> = new Map(),
): readonly SerializedKudos[] {
  return rows.map((row) =>
    serializeKudos(row, reactionsByKudosId.get(row.id) ?? []),
  );
}

/** Same as {@link serializeKudosList} but for the lead-only review variant. */
export function serializeHiddenKudosList(
  rows: readonly KudosRow[],
  reactionsByKudosId: ReadonlyMap<string, readonly KudosReactionSummary[]> = new Map(),
): readonly SerializedHiddenKudos[] {
  return rows.map((row) =>
    serializeHiddenKudos(row, reactionsByKudosId.get(row.id) ?? []),
  );
}
