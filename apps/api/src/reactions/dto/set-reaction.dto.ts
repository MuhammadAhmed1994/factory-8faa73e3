import { IsIn } from "class-validator";
import type { ReactionEmojiValue } from "../../kudos/kudos.serializer";

/**
 * Input DTO of the reactions feature (EP-5, ADR-4).
 *
 * The reaction body is exactly one field - `emoji` - whose value must be one of
 * the four curated emoji characters (Q-3's recommended fixed set). Validation
 * lives on the DTO so the `ValidationPipe` answers **400** for any other value
 * *before* the handler, the service or the database is reached.
 */

/**
 * The curated emoji characters as they travel on the wire (ADR-4).
 *
 * Written with escape sequences on purpose: the heart is U+2764 followed by the
 * **invisible** variation selector U+FE0F, which an editor can silently strip
 * and a copy/paste can just as silently keep. Spelling the code points out
 * keeps the set byte-exact against the ADR.
 */
export const THUMBS_UP_EMOJI = "\u{1F44D}"; // 👍
export const HEART_EMOJI = "\u2764\uFE0F"; // ❤️
export const TADA_EMOJI = "\u{1F389}"; // 🎉
export const RAISED_HANDS_EMOJI = "\u{1F64C}"; // 🙌

/**
 * The closed curated set `emoji` is validated against (`@IsIn`, ADR-4).
 *
 * A `readonly string[]` (not a tuple) so the decorator's argument is a plain
 * array at runtime while the literal union below keeps compile-time safety.
 */
export const CURATED_REACTION_EMOJIS: readonly string[] = [
  THUMBS_UP_EMOJI,
  HEART_EMOJI,
  TADA_EMOJI,
  RAISED_HANDS_EMOJI,
];

/** One of the four curated emoji characters (the wire form of a reaction). */
export type CuratedReactionEmoji =
  | typeof THUMBS_UP_EMOJI
  | typeof HEART_EMOJI
  | typeof TADA_EMOJI
  | typeof RAISED_HANDS_EMOJI;

/**
 * Maps a curated emoji character to the value stored in the `ReactionEmoji`
 * Prisma enum (`THUMBS_UP | HEART | TADA | RAISED_HANDS`, ADR-4).
 *
 * The inverse direction lives in `kudos/kudos.serializer.ts`
 * (`reactionEmojiChar`), which every kudos read uses to render the stored enum
 * back as a character.
 */
export const EMOJI_TO_REACTION_ENUM: Readonly<
  Record<CuratedReactionEmoji, ReactionEmojiValue>
> = {
  [THUMBS_UP_EMOJI]: "THUMBS_UP",
  [HEART_EMOJI]: "HEART",
  [TADA_EMOJI]: "TADA",
  [RAISED_HANDS_EMOJI]: "RAISED_HANDS",
};

/**
 * Resolves a curated emoji character to its stored enum value.
 *
 * Every caller reaches this *after* the DTO has validated the character, so an
 * unknown value is a programming error rather than a client error - it throws
 * loudly instead of persisting a nonsense enum.
 */
export function reactionEmojiEnum(emoji: string): ReactionEmojiValue {
  const value = (EMOJI_TO_REACTION_ENUM as Record<string, ReactionEmojiValue>)[
    emoji
  ];
  if (value === undefined) {
    throw new Error(`"${emoji}" is not part of the curated reaction set.`);
  }
  return value;
}

/** Body of `PUT /api/v1/kudos/:id/reactions` (ADR-4): `{"emoji":"👍"}`. */
export class SetReactionDto {
  /**
   * The caller's single reaction on that kudos. Anything outside the curated
   * set is rejected with **400** by the global `ValidationPipe`.
   */
  @IsIn(CURATED_REACTION_EMOJIS)
  readonly emoji!: string;
}
