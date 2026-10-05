import { Injectable, NotFoundException } from "@nestjs/common";

import { PrismaService } from "@/prisma/prisma.service";

/**
 * The entire body of `POST /api/v1/kudos/:id/hide`.
 *
 * Deliberately just the hidden kudos' `id` — nothing else. ADR-7 fixes the
 * uniform kudos resource and states that hidden state is never exposed, so the
 * hide action answers with the smallest useful acknowledgement: which kudos the
 * lead just hid. In particular no `hiddenAt`/`hiddenBy` is echoed here (those
 * exist only on the lead-only review variant of `GET /api/v1/kudos?hidden=true`
 * owned by the kudos module), and the row itself is never returned, because the
 * board refetches `GET /api/v1/kudos` to re-render.
 */
export interface HiddenKudos {
  readonly id: string;
}

/**
 * Moderation write access for the kudos resource (EP-6).
 *
 * Hiding is a **soft** action (ADR-5 / Q-4): `hiddenAt` is set and the kudos
 * row plus all of its reactions are retained, so the board's read path —
 * `KudosService.list`, which filters `hiddenAt: null` — simply stops returning
 * the row. Nothing is ever deleted, and no aggregate or counter is maintained.
 *
 * The role check lives in `RolesGuard` (`@Roles(MemberRole.LEAD)`) rather than
 * here, so the service can stay a plain, guard-agnostic write.
 */
@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `POST /api/v1/kudos/:id/hide` — soft-hide one kudos (AC-17 / AC-18).
   *
   * * Sets `hiddenAt` to "now" **only when it is still null**, so hiding an
   *   already-hidden kudos is idempotent: the second call still answers 2xx and
   *   the original hide timestamp survives untouched.
   * * Retains the row and its reactions (ADR-5) — an `UPDATE`, never a
   *   `DELETE`.
   * * @throws {NotFoundException} (**404**) when no kudos carries the given id,
   *   so a typo'd or stale id is distinguishable from a successful hide.
   *
   * @param kudosId the `:id` path parameter
   * @returns the id of the now-hidden kudos
   */
  async hide(kudosId: string): Promise<HiddenKudos> {
    const now = new Date();

    // One conditional UPDATE. The `hiddenAt: null` half of the predicate is
    // what makes the action idempotent *and* what preserves the first hide's
    // timestamp: an already-hidden row matches zero rows here and is left
    // exactly as it was.
    const hidden = await this.prisma.kudos.updateMany({
      where: { id: kudosId, hiddenAt: null },
      data: { hiddenAt: now },
    });

    if (hidden.count === 0) {
      // Either the kudos does not exist, or it is already hidden. Only the
      // former is an error; the latter is the idempotent success case.
      const existing = await this.prisma.kudos.findUnique({
        where: { id: kudosId },
        select: { id: true },
      });

      if (existing === null) {
        throw new NotFoundException(`No kudos found with id ${kudosId}`);
      }
    }

    return { id: kudosId };
  }
}
