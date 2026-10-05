import { IsIn, IsString } from "class-validator";

import { REACTION_EMOJIS, type ReactionEmoji } from "@/app.config";

/**
 * Request body of `PUT /api/v1/kudos/:id/reactions` (EP-5).
 *
 * ADR-4 fixes the payload to exactly one field, `emoji`, whose value must come
 * from the curated four-emoji set of Q-3 (`REACTION_EMOJIS` in
 * `src/app.config.ts`). `@IsIn` is the whole validation rule: any other value —
 * an uncurated emoji, an arbitrary string, a number — fails validation and the
 * global `ValidationPipe` registered in `src/main.ts` answers **400** instead of
 * letting an unknown value reach the database enum.
 *
 * `emoji` is typed as the curated-character union so the service can index its
 * emoji→enum mapping without a cast; the pipe, not a hand-rolled `if`, is what
 * guarantees the runtime value actually is one of them.
 */
export class SetReactionDto {
  /**
   * The caller's reaction, from the curated set 👍 ❤️ 🎉 🙌 (ADR-4 / Q-3).
   *
   * One reaction per member per kudos (C-4) is *not* expressed here: it is a
   * property of the (kudosId, memberId) pair the service upserts on, not of the
   * request body.
   */
  @IsString({ message: "emoji must be a string" })
  @IsIn([...REACTION_EMOJIS], {
    message: `emoji must be one of the curated reactions: ${REACTION_EMOJIS.join(
      " ",
    )}`,
  })
  emoji!: ReactionEmoji;
}
