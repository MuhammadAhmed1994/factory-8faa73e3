import { Controller, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { MemberRole } from "@prisma/client";

import { Roles } from "@/common/decorators/roles.decorator";
import { RolesGuard } from "@/common/guards/roles.guard";
import { SessionGuard } from "@/common/guards/session.guard";
// `API_V1_PREFIX` ("api/v1") is the one exported constant the kudos module
// owns; its doc comment prescribes exactly this reuse for the later feature
// modules (reactions, moderation), so every controller spells the versioned
// path identically instead of retyping the string.
import { API_V1_PREFIX } from "@/kudos/kudos.controller";

import {
  ModerationService,
  type HiddenKudos,
} from "./moderation.service";

/**
 * Lead-only moderation of the board (EP-6, ADR-5).
 *
 * Every route carries both guards, in this order:
 *
 * 1. {@link SessionGuard} — no session cookie, no handler: **401** (NFR/ADR-1).
 * 2. {@link RolesGuard} — an authenticated member whose role is not `LEAD`
 *    never reaches the handler: **403** (AC-18), never 401, because the caller
 *    *is* authenticated, just not permitted.
 *
 * The controller only binds the route and delegates; the soft-hide write, its
 * idempotency and the 404-for-an-unknown-id all live in
 * {@link ModerationService}.
 */
@Controller(`${API_V1_PREFIX}/kudos`)
@UseGuards(SessionGuard, RolesGuard)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  /**
   * `POST /api/v1/kudos/:id/hide` — soft-hide a kudos (AC-17).
   *
   * `@HttpCode(200)` because the action creates nothing: `hiddenAt` is set on
   * an existing row and the body is `{ id }`, not a created resource. The call
   * is idempotent — an already-hidden kudos still answers 2xx.
   *
   * `@Roles(MemberRole.LEAD)` is what makes the endpoint lead-only; a
   * signed-in regular `MEMBER` is turned away with **403** by
   * {@link RolesGuard} before this handler runs, and the kudos therefore stays
   * visible on the board for everyone.
   *
   * The response deliberately carries only `{ id }`: ADR-7 never exposes hidden
   * state, and the one variant that *does* is the lead-only
   * `GET /api/v1/kudos?hidden=true`, owned by the kudos module.
   */
  @Post(":id/hide")
  @HttpCode(200)
  @Roles(MemberRole.LEAD)
  hide(@Param("id") id: string): Promise<HiddenKudos> {
    return this.moderation.hide(id);
  }
}
