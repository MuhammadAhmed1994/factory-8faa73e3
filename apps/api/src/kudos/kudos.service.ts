import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { MemberRole } from "@prisma/client";

import { KUDOS_PAGE_SIZE } from "@/app.config";
import type { AuthenticatedMember } from "@/common/guards/session.guard";
import { PrismaService } from "@/prisma/prisma.service";

import type { CreateKudosDto } from "./dto/create-kudos.dto";
import {
  serializeKudos,
  type KudosRow,
  type SerializedKudos,
  type SerializedKudosWithHiddenState,
} from "./kudos.serializer";

/**
 * Board page size, fixed by constraint C-3 / ADR-6.
 *
 * It is deliberately *not* a caller input: the only pagination knob the board
 * exposes is `?page=N`.
 */
const PAGE_SIZE = KUDOS_PAGE_SIZE;

/**
 * The single Prisma projection every kudos read uses.
 *
 * One shape serves both the visible board and the lead-only hidden review
 * variant, so the serialiser always sees the fields it needs — including
 * `hiddenAt`, which the standard ADR-7 shape simply never exposes.
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

/** Options accepted by {@link KudosService.list}. */
export interface ListKudosOptions {
  /** Raw `?page` value; see {@link normalisePage}. */
  readonly page?: string | number;
  /** Raw `?hidden` value; see {@link parseHidden}. */
  readonly hidden?: string | boolean;
}

/**
 * Clamps a requested page onto the 1-based sequence (ADR-6).
 *
 * `?page=0`, a negative page, a non-numeric page and a missing page all resolve
 * to page 1 rather than erroring: the board's pagination control only ever
 * emits `>= 1`, and a page past the end is already an empty array.
 */
export const normalisePage = (raw: string | number | undefined): number => {
  const candidate =
    typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(candidate)) {
    return 1;
  }
  const page = Math.trunc(candidate);
  return page >= 1 ? page : 1;
};

/**
 * Reads `?hidden` as a boolean, defaulting to `false`.
 *
 * Only the literal truthy spellings (`true`, `1`, `yes`) opt in to the review
 * variant; anything else — including `?hidden=false` — means "the normal board".
 */
export const parseHidden = (raw: string | boolean | undefined): boolean => {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (raw === undefined) {
    return false;
  }
  return ["true", "1", "yes"].includes(raw.trim().toLowerCase());
};

/**
 * Read + write access for the kudos resource (EP-3 / EP-4).
 *
 * All filtering, ordering and pagination are expressed in the Prisma query —
 * never an in-memory `.sort()` — because the `id desc` tiebreak of ADR-6 is
 * what keeps pages stable when several kudos share a timestamp.
 */
@Injectable()
export class KudosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `GET /api/v1/kudos?page=N` — the newest-first board (AC-10 / AC-11).
   *
   * * Default: only visible kudos (`hiddenAt: null`), ordered `createdAt desc`
   *   then `id desc`, exactly `KUDOS_PAGE_SIZE` rows.
   * * `hidden: true`: only soft-hidden kudos, newest first, same page size.
   *   Lead-only — a regular member gets **403**, never an empty 200 that would
   *   read as "nothing was ever hidden".
   *
   * Reaction counts are computed at read time from the included `reactions`
   * relation; until the reactions module lands every kudos has none, so the
   * serialiser emits `reactions: []`.
   */
  async list(
    member: AuthenticatedMember,
    options: ListKudosOptions = {},
  ): Promise<readonly (SerializedKudos | SerializedKudosWithHiddenState)[]> {
    const hidden = parseHidden(options.hidden);

    if (hidden && member.role !== MemberRole.LEAD) {
      throw new ForbiddenException("Only team leads can review hidden kudos");
    }

    const page = normalisePage(options.page);

    const rows = await this.prisma.kudos.findMany({
      where: hidden ? { hiddenAt: { not: null } } : { hiddenAt: null },
      select: KUDOS_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    });

    return rows.map((row) =>
      serializeKudos(toKudosRow(row), {
        viewerId: member.id,
        withHiddenState: hidden,
      }),
    );
  }

  /**
   * `POST /api/v1/kudos` — publish a kudos (AC-6 / AC-8 / AC-9).
   *
   * `authorId` always comes from the session, never from the body, so a caller
   * cannot thank someone under another member's name. `recipient` is resolved
   * to an existing member before anything is written; an unknown recipient is a
   * 400 and persists nothing.
   */
  async create(
    member: AuthenticatedMember,
    dto: CreateKudosDto,
  ): Promise<SerializedKudos> {
    const recipient = await this.resolveRecipient(dto.recipient);

    const created = await this.prisma.kudos.create({
      data: {
        authorId: member.id,
        recipientId: recipient.id,
        message: dto.message,
      },
      select: KUDOS_SELECT,
    });

    return serializeKudos(toKudosRow(created), { viewerId: member.id });
  }

  /**
   * Resolves the DTO's `recipient` to an existing `Member` row.
   *
   * Accepting the id *or* the email reflects how the roster is consumed: the
   * web composer holds an email (ADR-2: seeded accounts, no self-signup), while
   * anything already holding a member id can use it directly. Emails are
   * compared case-insensitively against the unique `email` column.
   */
  private async resolveRecipient(
    recipient: string,
  ): Promise<{ readonly id: string }> {
    const found = await this.prisma.member.findFirst({
      where: {
        OR: [{ id: recipient }, { email: recipient.toLowerCase() }],
      },
      select: { id: true },
    });

    if (found === null) {
      throw new BadRequestException(`Unknown recipient: ${recipient}`);
    }

    return found;
  }
}

/**
 * Narrows a row from the shared projection onto {@link KudosRow}.
 *
 * The generated Prisma row types only exist once `prisma generate` has run, so
 * this local cast keeps `KudosService` type-checkable in both states — the same
 * approach as `src/prisma/prisma.service.ts` and `prisma/seed.ts`.
 */
const toKudosRow = (row: unknown): KudosRow => row as KudosRow;
