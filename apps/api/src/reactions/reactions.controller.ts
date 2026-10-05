import {
  Body,
  Controller,
  HttpCode,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";

import { CurrentMember } from "@/common/decorators/current-member.decorator";
import {
  SessionGuard,
  type AuthenticatedMember,
} from "@/common/guards/session.guard";
import { API_V1_PREFIX } from "@/kudos/kudos.controller";

import { SetReactionDto } from "./dto/set-reaction.dto";
import { ReactionsService } from "./reactions.service";

/**
 * Reactions endpoint (EP-5).
 *
 * The route sits behind {@link SessionGuard}, so a request with no valid
 * session cookie is a **401** before any handler runs (ADR-1). Everything else
 * is delegated: `SetReactionDto` + the global `ValidationPipe` own the curated
 * emoji rule, `ReactionsService` owns the upsert and the ADR-7 payload.
 */
@Controller(`${API_V1_PREFIX}/kudos`)
@UseGuards(SessionGuard)
export class ReactionsController {
  constructor(private readonly reactions: ReactionsService) {}

  /**
   * `PUT /api/v1/kudos/:id/reactions` — set or replace the caller's reaction.
   *
   * PUT-replace is the whole point (ADR-4): the caller's previous emoji, if
   * any, is overwritten rather than added alongside. Responds **200** with the
   * kudos in the uniform ADR-7 shape, including the recomputed `reactions`
   * array. An unknown `:id` surfaces the service's **404**; an uncurated
   * `emoji` is answered **400** by the pipe and never reaches this handler.
   */
  @Put(":id/reactions")
  @HttpCode(200)
  async setReaction(
    @Param("id") id: string,
    @Body() dto: SetReactionDto,
    @CurrentMember() member: AuthenticatedMember,
  ) {
    return this.reactions.setReaction(member, id, dto);
  }
}
