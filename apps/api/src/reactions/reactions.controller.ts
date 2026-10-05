import {
  Body,
  Controller,
  HttpStatus,
  Param,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { CurrentMember } from "../common/decorators/current-member.decorator";
import { SessionGuard, type AuthenticatedMember } from "../common/guards/session.guard";
import { SetReactionDto } from "./dto/set-reaction.dto";
import { ReactionsService } from "./reactions.service";

/**
 * Thin routing layer for reactions (EP-5).
 *
 * Every decision lives elsewhere: authentication in `SessionGuard`, the emoji
 * whitelist in `SetReactionDto`, the upsert-replace and the aggregate query in
 * `ReactionsService`, and the response shape in `kudos/kudos.serializer.ts`.
 * The handler only adapts HTTP to the service.
 *
 * The `api/v1` prefix is declared here (not via `setGlobalPrefix()`) exactly
 * like the kudos controller, so this module owns its route table and stays
 * correct no matter how the host application is bootstrapped.
 */
@Controller("api/v1/kudos/:id/reactions")
@UseGuards(SessionGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    errorHttpStatusCode: HttpStatus.BAD_REQUEST,
  }),
)
export class ReactionsController {
  constructor(private readonly reactions: ReactionsService) {}

  /**
   * `PUT /api/v1/kudos/:id/reactions` - sets the caller's single curated-emoji
   * reaction on that kudos (ADR-4).
   *
   * Answers **200** with the kudos in the uniform shape (ADR-7), its reactions
   * recomputed at read time. Missing/invalid session cookie -> **401** by the
   * guard; unknown kudos id -> **404**; an emoji outside the curated set ->
   * **400** by the pipe - all before this body runs.
   */
  @Put()
  async set(
    @CurrentMember() member: AuthenticatedMember,
    @Param("id") kudosId: string,
    @Body() dto: SetReactionDto,
  ) {
    return this.reactions.setReaction(member, kudosId, dto);
  }
}
