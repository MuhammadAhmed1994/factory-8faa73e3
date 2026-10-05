import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { MemberRole } from "@prisma/client";
import { CurrentMember } from "../common/decorators/current-member.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import {
  SessionGuard,
  type AuthenticatedMember,
} from "../common/guards/session.guard";
import { ModerationService } from "./moderation.service";

/**
 * The lead role as the seeded `Member.role` stores it (ADR-2).
 *
 * Written as a literal cast to `MemberRole` rather than `MemberRole.LEAD` so
 * this module has no *runtime* dependency on `@prisma/client` - it therefore
 * loads (and its routes register) even in the window before
 * `prisma generate`, exactly like `KudosService`'s role comparison.
 */
const LEAD_ROLE = "LEAD" as MemberRole;

/**
 * Thin routing layer for moderation (EP-6).
 *
 * Every decision lives elsewhere: authentication in `SessionGuard`, the lead
 * rule in `@Roles(LEAD)` + `RolesGuard`, and the soft-hide semantics in
 * `ModerationService`. The handler only adapts HTTP to the service.
 *
 * Guards execute in the order they are listed, so the pair is always
 * `@UseGuards(SessionGuard, RolesGuard)`: the session is resolved (401 when the
 * cookie is missing, unknown or expired, per the NFR) *before* the role is
 * checked (403 for an authenticated regular MEMBER, AC-18).
 *
 * The `api/v1` prefix is declared on the route itself - like every feature
 * controller here - so this module owns its path no matter how the host
 * application is bootstrapped.
 */
@Controller("api/v1/kudos")
@UseGuards(SessionGuard, RolesGuard)
@Roles(LEAD_ROLE)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  /**
   * `POST /api/v1/kudos/:id/hide` - soft-hides one kudos (EP-6).
   *
   * Answers **200** with `{ id }`: the kudos row and its reactions are retained
   * (ADR-5) and only `hiddenAt` is set, which is what removes it from the board
   * for everyone. Hiding an already-hidden kudos answers 200 again, an unknown
   * id answers 404, and no hidden-state field beyond the T-6 lead review
   * variant is ever exposed here (ADR-7).
   */
  @Post(":id/hide")
  @HttpCode(HttpStatus.OK)
  async hide(
    @CurrentMember() member: AuthenticatedMember,
    @Param("id") kudosId: string,
  ) {
    return this.moderation.hide(member, kudosId);
  }
}
