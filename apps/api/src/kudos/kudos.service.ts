import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedMember } from "../common/guards/session.guard";
import {
  KUDOS_PAGE_SIZE,
  type CreateKudosDto,
  type ListKudosQueryDto,
} from "./dto/create-kudos.dto";
import {
  reactionEmojiChar,
  serializeHiddenKudosList,
  serializeKudos,
  serializeKudosList,
  type KudosMemberRef,
  type KudosReactionSummary,
  type KudosRow,
  type SerializedHiddenKudos,
  type SerializedKudos,
} from "./kudos.serializer";

/**
 * The column slice every kudos read uses, narrowed to exactly what the
 * serializer consumes so `passwordHash` is never even selected (ADR-7).
 */
export interface KudosSelect {
  readonly id: true;
  readonly message: true;
  readonly hiddenAt: true;
  readonly createdAt: true;
  readonly author: {
    readonly select: { readonly id: true; readonly email: true };
  };
  readonly recipient: {
    readonly select: { readonly id: true; readonly email: true };
  };
}

/** Prisma filters the board reads need: "visible only" and "hidden only". */
export type KudosVisibilityFilter =
  | { readonly hiddenAt: null }
  | { readonly hiddenAt: { readonly not: null } };

/** One clause of the ADR-6 stable sort. */
export type KudosOrderBy =
  | { readonly createdAt: "desc" }
  | { readonly id: "desc" };

/**
 * The slice of `PrismaClient` this service needs.
 *
 * Declared structurally (rather than importing generated model types) so the
 * module keeps type-checking before `prisma generate` has produced the client -
 * the same approach `PrismaService` and `prisma/seed.ts` take.
 */
interface KudosPrismaClient {
  readonly kudos: {
    findMany(args: {
      where: KudosVisibilityFilter;
      orderBy: readonly KudosOrderBy[];
      skip?: number;
      take?: number;
      select: KudosSelect;
    }): Promise<KudosRow[]>;
    count(args: { where: KudosVisibilityFilter }): Promise<number>;
    create(args: {
      data: { authorId: string; recipientId: string; message: string };
      select: KudosSelect;
    }): Promise<KudosRow>;
  };
  readonly member: {
    findFirst(args: {
      where: {
        readonly OR: ReadonlyArray<
          { readonly email: string } | { readonly id: string }
        >;
      };
      select: { readonly id: true; readonly email: true };
    }): Promise<KudosMemberRef | null>;
  };
  readonly reaction: {
    findMany(args: {
      where: { readonly kudosId: { readonly in: readonly string[] } };
      select: {
        readonly kudosId: true;
        readonly emoji: true;
        readonly memberId: true;
      };
    }): Promise<readonly { kudosId: string; emoji: string; memberId: string }[]>;
  };
}

export { KUDOS_PAGE_SIZE };

/** One page of the board (ADR-6): the items plus the paging metadata. */
export interface KudosPage {
  readonly items: readonly SerializedKudos[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/** One page of the lead-only hidden review list. */
export interface HiddenKudosPage {
  readonly items: readonly SerializedHiddenKudos[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/**
 * Kudos business logic and persistence (EP-3 / EP-4).
 *
 * Controllers stay thin; every query and rule lives here:
 *   * the board is **only** the non-hidden rows, newest first (`createdAt`
 *     desc, `id` desc as the stable tiebreak) and exactly 20 per page (ADR-6);
 *   * reaction aggregates are computed at read time - nothing is stored - and
 *     are empty until the reactions module lands (ADR-7);
 *   * a created kudos is authored by the session member and its recipient is
 *     resolved to an existing seeded member (AC-6 / AC-9).
 */
@Injectable()
export class KudosService {
  constructor(private readonly prisma: PrismaService) {}

  /** `PrismaService` narrowed to the delegates this service touches. */
  private get db(): KudosPrismaClient {
    return this.prisma as unknown as KudosPrismaClient;
  }

  /**
   * Lists one page of the visible board for the signed-in member, newest first
   * (EP-3, ADR-6).
   *
   * `page` defaults to 1 when the query omits it; the page size is fixed at
   * {@link KUDOS_PAGE_SIZE} (20) and is never taken from the query string, so a
   * caller cannot widen a page. Soft-hidden kudos are excluded for everyone
   * (ADR-5) and every reaction aggregate carries `mine` for this caller.
   */
  async listBoardForMember(
    member: AuthenticatedMember,
    query: ListKudosQueryDto = {},
  ): Promise<KudosPage> {
    const page = normalizePage(query.page);

    const rows = await this.fetchPage(VISIBLE_ONLY, page);
    const total = await this.db.kudos.count({ where: VISIBLE_ONLY });
    const reactions = await this.reactionsByKudosId(rows, member.id);

    return {
      items: serializeKudosList(rows, reactions),
      page,
      pageSize: KUDOS_PAGE_SIZE,
      total,
    };
  }

  /**
   * The lead-only review variant of the board (`?hidden=true`): only the
   * soft-hidden kudos, newest first, in the standard shape plus
   * `hiddenAt`/`hiddenBy`.
   *
   * The role rule is enforced here rather than with `@Roles()`/`RolesGuard`,
   * because the two variants share one route and the guard chain cannot depend
   * on the query string. A signed-in MEMBER therefore gets **403**
   * (authenticated but not privileged, ADR-5) - never 401, which stays reserved
   * for "no session at all" and is handled by `SessionGuard`.
   */
  async listHiddenForMember(
    member: AuthenticatedMember,
    query: ListKudosQueryDto = {},
  ): Promise<HiddenKudosPage> {
    if (!isLead(member)) {
      throw new ForbiddenException("Only team leads may review hidden kudos.");
    }

    const page = normalizePage(query.page);

    const rows = await this.fetchPage(HIDDEN_ONLY, page);
    const total = await this.db.kudos.count({ where: HIDDEN_ONLY });
    const reactions = await this.reactionsByKudosId(rows, member.id);

    return {
      items: serializeHiddenKudosList(rows, reactions),
      page,
      pageSize: KUDOS_PAGE_SIZE,
      total,
    };
  }

  /**
   * Persists one kudos authored by the session member (EP-4, AC-6).
   *
   * The 1-280 character message rule is enforced by `CreateKudosDto`, so a bad
   * payload is rejected with **400** by the `ValidationPipe` before this method
   * - or the database - is ever reached. Here `recipient` is resolved to an
   * existing seeded member, answering **400** when it matches nobody: an
   * unknown colleague is a client mistake, not a missing resource.
   */
  async create(
    author: AuthenticatedMember,
    dto: CreateKudosDto,
  ): Promise<SerializedKudos> {
    const recipient = await this.resolveRecipient(dto.recipient);

    const created = await this.db.kudos.create({
      data: {
        authorId: author.id,
        recipientId: recipient.id,
        message: dto.message,
      },
      select: KUDOS_SELECT,
    });

    // A brand-new kudos has no reactions yet (ADR-7: `reactions` is `[]` until
    // the reactions module lands).
    return serializeKudos(created, []);
  }

  /** Resolves a `recipient` value - a member's email or id - or throws 400. */
  private async resolveRecipient(recipient: string): Promise<KudosMemberRef> {
    const trimmed = recipient.trim();
    if (trimmed === "") {
      throw new BadRequestException("recipient must not be empty.");
    }

    const member = await this.db.member.findFirst({
      where: { OR: [{ email: trimmed }, { id: trimmed }] },
      select: { id: true, email: true },
    });

    if (member === null) {
      throw new BadRequestException(
        `recipient "${trimmed}" does not match any member.`,
      );
    }

    return member;
  }

  /** Fetches one page of kudos for a visibility filter, in the ADR-6 order. */
  private fetchPage(
    where: KudosVisibilityFilter,
    page: number,
  ): Promise<KudosRow[]> {
    return this.db.kudos.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * KUDOS_PAGE_SIZE,
      take: KUDOS_PAGE_SIZE,
      select: KUDOS_SELECT,
    });
  }

  /**
   * Computes the per-kudos reaction aggregates at read time (ADR-7).
   *
   * Nothing is stored: the reactions of just this page's kudos are fetched with
   * one indexed query and grouped by `(kudosId, emoji)` in memory. `mine` is
   * true when the caller's own single reaction (C-4) is in that group, which is
   * everything the reaction picker needs without a second round-trip.
   */
  private async reactionsByKudosId(
    rows: readonly KudosRow[],
    memberId: string,
  ): Promise<Map<string, KudosReactionSummary[]>> {
    if (rows.length === 0) {
      return new Map();
    }

    const reactions = await this.db.reaction.findMany({
      where: { kudosId: { in: rows.map((row) => row.id) } },
      select: { kudosId: true, emoji: true, memberId: true },
    });

    const grouped = new Map<string, Map<string, MutableReaction>>();

    for (const reaction of reactions) {
      // The stored `ReactionEmoji` enum is surfaced as its emoji character
      // (ADR-4: 👍 ❤️ 🎉 🙌), which is the wire format the board renders.
      const emoji = reactionEmojiChar(reaction.emoji);
      const perKudos =
        grouped.get(reaction.kudosId) ?? new Map<string, MutableReaction>();
      const existing = perKudos.get(emoji);
      const mine = reaction.memberId === memberId;

      if (existing === undefined) {
        perKudos.set(emoji, { emoji, count: 1, mine });
      } else {
        existing.count += 1;
        existing.mine = existing.mine || mine;
      }

      grouped.set(reaction.kudosId, perKudos);
    }

    const result = new Map<string, KudosReactionSummary[]>();
    for (const [kudosId, perKudos] of grouped) {
      result.set(kudosId, [...perKudos.values()]);
    }
    return result;
  }
}

/** A reaction aggregate while it is still being accumulated. */
interface MutableReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

/** Visible kudos only: `hiddenAt IS NULL` (ADR-5). */
const VISIBLE_ONLY: KudosVisibilityFilter = { hiddenAt: null };

/** Soft-hidden kudos only: `hiddenAt IS NOT NULL`. */
const HIDDEN_ONLY: KudosVisibilityFilter = { hiddenAt: { not: null } };

/** The column slice shared by every kudos read (see {@link KudosSelect}). */
const KUDOS_SELECT: KudosSelect = {
  id: true,
  message: true,
  hiddenAt: true,
  createdAt: true,
  author: { select: { id: true, email: true } },
  recipient: { select: { id: true, email: true } },
};

/**
 * Defaults/normalises the 1-based page number (ADR-6).
 *
 * `ListKudosQueryDto` already rejects `page=0`, a negative and a non-integer
 * value, so this is a defensive default for callers that use the service
 * directly (and for the omitted-query case).
 */
function normalizePage(page: number | undefined): number {
  if (page === undefined || !Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.floor(page);
}

/**
 * True when the member is a team lead (ADR-2: `role` is assigned at seed time).
 *
 * Compared as a string so this module needs no *runtime* import of
 * `@prisma/client` - the enum's values are exactly these two strings.
 */
function isLead(member: AuthenticatedMember): boolean {
  return (member.role as unknown as string) === "LEAD";
}
