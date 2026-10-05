import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthenticatedMember } from "../common/guards/session.guard";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Moderation business logic and persistence (EP-6 / ADR-5).
 *
 * Hiding is deliberately a **soft** action:
 *
 *   * only `Kudos.hiddenAt` is set - the row is kept, never deleted, and its
 *     reactions are left untouched (ADR-5, Q-4's recommended option);
 *   * the board read (T-6) excludes `hiddenAt IS NOT NULL` rows, so one hide
 *     removes the kudos for *everyone*, not just for the lead;
 *   * the action is idempotent: hiding an already-hidden kudos answers 2xx
 *     again and leaves the original `hiddenAt` in place, so the first hide
 *     stays the audit-record timestamp no matter how often the control is
 *     activated;
 *   * an unknown kudos id answers **404** rather than being silently accepted.
 *
 * The response is intentionally minimal - `{ id }` (ADR-7): hidden state is
 * never surfaced here, and `hiddenAt`/`hiddenBy` belong to the lead-only review
 * variant that T-6 owns.
 */

/**
 * The lead role exactly as the seeded `Member.role` stores it (ADR-2).
 *
 * Compared as a string so this module needs no *runtime* import of
 * `@prisma/client` - the same approach `KudosService` takes.
 */
const LEAD_ROLE = "LEAD";

/** What `POST /api/v1/kudos/:id/hide` answers with (EP-6, ADR-7). */
export interface HiddenKudosAck {
  /** Id of the kudos that is now soft-hidden. Nothing else is exposed. */
  readonly id: string;
}

/** The column slice the moderation read uses: the key plus the hide flag. */
export interface ModerationKudosSelect {
  readonly id: true;
  readonly hiddenAt: true;
}

/** A kudos row as the moderation feature reads it back. */
export interface ModerationKudosRow {
  readonly id: string;
  readonly hiddenAt: Date | null;
}

/**
 * The slice of `PrismaClient` this service needs.
 *
 * Declared structurally (rather than importing generated model types) so the
 * module keeps type-checking before `prisma generate` has produced the client,
 * mirroring `KudosService` and `prisma/seed.ts`.
 */
interface ModerationPrismaClient {
  readonly kudos: {
    findUnique(args: {
      readonly where: { readonly id: string };
      readonly select: ModerationKudosSelect;
    }): Promise<ModerationKudosRow | null>;
    update(args: {
      readonly where: { readonly id: string };
      readonly data: { readonly hiddenAt: Date };
      readonly select: { readonly id: true };
    }): Promise<{ readonly id: string }>;
  };
}

/** The column slice every moderation read uses (see {@link ModerationKudosSelect}). */
const MODERATION_KUDOS_SELECT: ModerationKudosSelect = {
  id: true,
  hiddenAt: true,
};

/**
 * The soft-hide use case.
 *
 * `RolesGuard` + `@Roles(LEAD)` are the primary enforcement point on the route,
 * but the domain rule "only a lead may hide" (ADR-5) is restated here so the
 * service can never be called into hiding anything by a future caller that
 * forgot the guard. Both paths answer **403** for a regular member - 401 stays
 * reserved for "no session at all" and is owned by `SessionGuard`.
 */
@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

  /** `PrismaService` narrowed to the delegates this service touches. */
  private get db(): ModerationPrismaClient {
    return this.prisma as unknown as ModerationPrismaClient;
  }

  /**
   * Soft-hides one kudos (EP-6).
   *
   * @returns `{ id }` of the hidden kudos - the only field the hide response
   *   carries (ADR-7).
   * @throws `ForbiddenException` when the actor is not a team lead.
   * @throws `NotFoundException` when no kudos carries that id.
   */
  async hide(
    actor: AuthenticatedMember,
    kudosId: string,
  ): Promise<HiddenKudosAck> {
    assertLead(actor);

    const existing = await this.findKudos(kudosId);

    if (existing.hiddenAt !== null) {
      // Already soft-hidden: report success again without touching the row, so
      // the first hide's timestamp survives and the endpoint stays idempotent.
      return { id: existing.id };
    }

    // The soft-hide itself. Reactions are never deleted (ADR-5); the board read
    // filters on `hiddenAt IS NOT NULL`, which is what makes it vanish for all.
    const hiddenAt = new Date();
    const hidden = await this.db.kudos.update({
      where: { id: existing.id },
      data: { hiddenAt },
      select: { id: true },
    });

    return { id: hidden.id };
  }

  /** Loads one kudos row or answers 404 for an id nothing carries. */
  private async findKudos(kudosId: string): Promise<ModerationKudosRow> {
    const trimmed = kudosId.trim();
    const row = await this.db.kudos.findUnique({
      where: { id: trimmed },
      select: MODERATION_KUDOS_SELECT,
    });

    if (row === null) {
      throw new NotFoundException(`No kudos with id "${trimmed}".`);
    }

    return row;
  }
}

/** True when the member is a team lead (ADR-2: `role` is assigned at seed time). */
function assertLead(actor: AuthenticatedMember): void {
  if ((actor.role as unknown as string) !== LEAD_ROLE) {
    throw new ForbiddenException("Only team leads may hide a kudos.");
  }
}
