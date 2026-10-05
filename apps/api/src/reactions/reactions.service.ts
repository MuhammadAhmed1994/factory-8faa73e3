import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";

import { REACTION_EMOJIS, type ReactionEmoji as ReactionEmojiCharacter } from "@/app.config";
import type { AuthenticatedMember } from "@/common/guards/session.guard";
import {
  serializeKudos,
  type KudosRow,
  type SerializedKudos,
} from "@/kudos/kudos.serializer";
import { PrismaService } from "@/prisma/prisma.service";

import type { SetReactionDto } from "./dto/set-reaction.dto";

/**
 * Write access for the caller's single reaction on a kudos (EP-5).
 *
 * `Reaction.emoji` is the Prisma enum `THUMBS_UP | HEART | TADA |
 * RAISED_HANDS` while the API speaks the curated characters of ADR-4. This
 * module owns that translation in the write direction; the read direction
 * (enum value → character) already lives in `kudos.serializer.ts`, so an emoji
 * character is never written to, or read from, the database.
 */

/**
 * The `ReactionEmoji` values of `prisma/schema.prisma`, spelled out locally.
 *
 * The generated Prisma namespace only exists once `prisma generate` has run, so
 * importing that enum from `@prisma/client` here would make
 * `pnpm --filter api typecheck` fail in a not-yet-generated workspace — the
 * same trade-off `PrismaService` and `prisma/seed.ts` already make.
 */
export type ReactionEnumValue = "THUMBS_UP" | "HEART" | "TADA" | "RAISED_HANDS";

/**
 * The stored enum values, in the order `REACTION_EMOJIS` declares their
 * characters.
 *
 * `prisma/schema.prisma` documents the correspondence as
 * "👍 ❤️ 🎉 🙌 → THUMBS_UP | HEART | TADA | RAISED_HANDS", i.e. exactly
 * positional, so pairing the two arrays index-by-index is the declared mapping
 * — not an assumption about it.
 */
const REACTION_ENUM_VALUES: readonly ReactionEnumValue[] = [
  "THUMBS_UP",
  "HEART",
  "TADA",
  "RAISED_HANDS",
];

/**
 * emoji character → stored `ReactionEmoji` enum value (ADR-4 / Q-3).
 *
 * Built from `REACTION_EMOJIS` itself rather than from retyped literals, so the
 * mapping can never drift from the DTO's `@IsIn` set: not by ordering, and not
 * by an invisible difference such as a missing `U+FE0F` variation selector on
 * `❤️`. The length guard below makes a mismatch loud at module load instead of
 * silently mis-mapping one emoji.
 */
const ENUM_BY_EMOJI: Readonly<
  Record<ReactionEmojiCharacter, ReactionEnumValue>
> = Object.fromEntries(
  REACTION_EMOJIS.map((emoji, index) => [emoji, REACTION_ENUM_VALUES[index]]),
) as Readonly<Record<ReactionEmojiCharacter, ReactionEnumValue>>;

if (REACTION_EMOJIS.length !== REACTION_ENUM_VALUES.length) {
  throw new Error(
    "REACTION_EMOJIS and the ReactionEmoji enum values are out of step: " +
      `found ${REACTION_EMOJIS.length} curated characters for ` +
      `${REACTION_ENUM_VALUES.length} enum values`,
  );
}

/**
 * The kudos projection read back after an upsert.
 *
 * Deliberately the same shape `KudosService` selects, so `serializeKudos` emits
 * the identical ADR-7 resource from either module.
 */
const KUDOS_SELECT = {
  id: true,
  message: true,
  hiddenAt: true,
  createdAt: true,
  author: { select: { id: true, email: true } },
  recipient: { select: { id: true, email: true } },
  reactions: { select: { emoji: true, memberId: true } },
} as const;

@Injectable()
export class ReactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `PUT /api/v1/kudos/:id/reactions` — create or replace the caller's single
   * reaction on a kudos, then return that kudos in the uniform ADR-7 shape with
   * counts recomputed at read time (AC-14 / AC-15 / AC-16).
   *
   * The upsert is keyed on the unique `(kudosId, memberId)` pair the schema
   * already enforces, so a repeat submit — same *or* different emoji — updates
   * the one existing row instead of inserting a second one (C-4). `memberId`
   * always comes from the session, never from the body.
   *
   * A kudos id matching no row is a **404**: reacting to nothing must not look
   * like it worked. A soft-hidden kudos stays addressable — ADR-5 keeps the row
   * and its reactions, and no AC restricts reacting to one.
   */
  async setReaction(
    member: AuthenticatedMember,
    kudosId: string,
    dto: SetReactionDto,
  ): Promise<SerializedKudos> {
    const kudos = await this.prisma.kudos.findUnique({
      where: { id: kudosId },
      select: { id: true },
    });

    if (kudos === null) {
      throw new NotFoundException(`Unknown kudos: ${kudosId}`);
    }

    // Unreachable while the DTO's `@IsIn` and this mapping share one source;
    // guarded anyway so a future mapping gap is a 400, never a Prisma 500.
    const emoji = ENUM_BY_EMOJI[dto.emoji];
    if (emoji === undefined) {
      throw new BadRequestException(
        `emoji must be one of the curated reactions: ${REACTION_EMOJIS.join(" ")}`,
      );
    }

    await this.prisma.reaction.upsert({
      where: { kudosId_memberId: { kudosId, memberId: member.id } },
      create: { kudosId, memberId: member.id, emoji },
      update: { emoji },
      select: { id: true },
    });

    // Re-read rather than upsert-and-return: the ADR-7 `reactions` array is a
    // read-time aggregate over *every* member's rows on that kudos, which a
    // single-row upsert result cannot describe.
    const row = await this.prisma.kudos.findUniqueOrThrow({
      where: { id: kudosId },
      select: KUDOS_SELECT,
    });

    return serializeKudos(row as KudosRow, { viewerId: member.id });
  }
}
