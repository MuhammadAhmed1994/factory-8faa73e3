import { Injectable, NotFoundException } from "@nestjs/common";
import type { AuthenticatedMember } from "../common/guards/session.guard";
import type { KudosSelect } from "../kudos/kudos.service";
import {
  reactionEmojiChar,
  serializeKudos,
  type KudosMemberRef,
  type KudosReactionSummary,
  type KudosRow,
  type SerializedKudos,
} from "../kudos/kudos.serializer";
import { PrismaService } from "../prisma/prisma.service";
import { reactionEmojiEnum, type SetReactionDto } from "./dto/set-reaction.dto";

/**
 * The slice of `PrismaClient` this service needs.
 *
 * Declared structurally (rather than importing generated model types) so the
 * module keeps type-checking before `prisma generate` has produced the client -
 * the same approach `PrismaService`, `prisma/seed.ts` and `KudosService` take.
 */
interface ReactionsPrismaClient {
  readonly kudos: {
    findUnique(args: {
      where: { readonly id: string };
      select: KudosSelect;
    }): Promise<KudosRow | null>;
  };
  readonly reaction: {
    upsert(args: {
      where: { readonly kudosId_memberId: { readonly kudosId: string; readonly memberId: string } };
      create: { readonly kudosId: string; readonly memberId: string; readonly emoji: string };
      update: { readonly emoji: string };
      select: { readonly id: true };
    }): Promise<{ id: string }>;
    findMany(args: {
      where: { readonly kudosId: string };
      select: {
        readonly emoji: true;
        readonly memberId: true;
      };
    }): Promise<readonly { emoji: string; memberId: string }[]>;
  };
}

/**
 * The column slice of `Kudos` the reaction response needs - the same one
 * `KudosService` selects, so the ADR-7 shape is identical everywhere and
 * `passwordHash` is never even fetched.
 */
const KUDOS_SELECT: KudosSelect = {
  id: true,
  message: true,
  hiddenAt: true,
  createdAt: true,
  author: { select: { id: true, email: true } },
  recipient: { select: { id: true, email: true } },
};

/**
 * Reaction business logic and persistence (EP-5, ADR-4).
 *
 * One member holds **exactly one** reaction per kudos (C-4): the row is written
 * with a Prisma `upsert` keyed on the schema's `@@unique([kudosId, memberId])`,
 * so a repeat submit - same *or* different emoji - replaces the existing row
 * and can never duplicate it (AC-15). The emoji character from the wire is
 * mapped to the stored `ReactionEmoji` enum, and the response is the uniform
 * kudos resource (ADR-7) with the counts computed at read time by grouping the
 * `Reaction` rows per emoji (AC-14 / AC-16).
 */
@Injectable()
export class ReactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** `PrismaService` narrowed to the delegates this service touches. */
  private get db(): ReactionsPrismaClient {
    return this.prisma as unknown as ReactionsPrismaClient;
  }

  /**
   * Creates or replaces the caller's single reaction on one kudos (EP-5).
   *
   * Answers with the whole kudos resource rather than the bare reaction, so the
   * board can update the card in place without a second round-trip (ADR-7).
   *
   * An unknown kudos `id` - and a soft-hidden one, which no longer exists for
   * anyone (ADR-5: hidden kudos never appear in responses) - is **404**.
   */
  async setReaction(
    member: AuthenticatedMember,
    kudosId: string,
    dto: SetReactionDto,
  ): Promise<SerializedKudos> {
    const emoji = reactionEmojiEnum(dto.emoji);

    const kudos = await this.db.kudos.findUnique({
      where: { id: kudosId },
      select: KUDOS_SELECT,
    });

    if (kudos === null || kudos.hiddenAt !== null) {
      throw new NotFoundException(`Kudos "${kudosId}" does not exist.`);
    }

    // The upsert-replace itself (AC-15): `kudosId_memberId` is the compound
    // unique key of `Reaction`, so the caller's previous reaction - whatever
    // emoji it held - is updated in place instead of inserted again.
    await this.db.reaction.upsert({
      where: { kudosId_memberId: { kudosId, memberId: member.id } },
      create: { kudosId, memberId: member.id, emoji },
      update: { emoji },
      select: { id: true },
    });

    const reactions = await this.db.reaction.findMany({
      where: { kudosId },
      select: { emoji: true, memberId: true },
    });

    return serializeKudos(kudos, aggregateReactions(reactions, member.id));
  }
}

/**
 * Groups one kudos' reaction rows into the ADR-7 aggregates (read time, nothing
 * stored): one entry per emoji with its member count, and `mine` true when the
 * caller's own single reaction is in that group.
 */
function aggregateReactions(
  rows: readonly { emoji: string; memberId: string }[],
  memberId: string,
): KudosReactionSummary[] {
  const grouped = new Map<string, MutableReaction>();

  for (const row of rows) {
    // The stored `ReactionEmoji` enum is surfaced as its emoji character
    // (ADR-4: 👍 ❤️ 🎉 🙌), which is the wire format the board renders.
    const emoji = reactionEmojiChar(row.emoji);
    const existing = grouped.get(emoji);
    const mine = row.memberId === memberId;

    if (existing === undefined) {
      grouped.set(emoji, { emoji, count: 1, mine });
    } else {
      existing.count += 1;
      existing.mine = existing.mine || mine;
    }
  }

  return [...grouped.values()];
}

/** A reaction aggregate while it is still being accumulated. */
interface MutableReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

/** Re-exported so the controller's return type can be stated precisely. */
export type { KudosMemberRef, SerializedKudos };
