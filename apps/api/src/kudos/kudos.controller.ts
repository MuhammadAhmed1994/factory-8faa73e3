import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { CurrentMember } from "@/common/decorators/current-member.decorator";
import { SessionGuard } from "@/common/guards/session.guard";
import type { AuthenticatedMember } from "@/common/guards/session.guard";

import { CreateKudosDto } from "./dto/create-kudos.dto";
import { KudosService } from "./kudos.service";

/**
 * The versioned API prefix every product endpoint is specified with
 * (EP-3 is `GET /api/v1/kudos`).
 *
 * `src/main.ts` deliberately registers no `setGlobalPrefix` — it is a plain
 * bootstrap with only the global `ValidationPipe` — so each feature controller
 * carries its own prefix. Keeping it in one exported constant means the later
 * feature modules (reactions, moderation) reuse it instead of retyping a string.
 */
export const API_V1_PREFIX = "api/v1";

/**
 * Kudos endpoints (EP-3 / EP-4).
 *
 * Both routes sit behind {@link SessionGuard}, so a request with no session
 * cookie is a **401** before any handler runs (AC-3, ADR-1). The controller
 * only binds the request and delegates; shape validation, authorisation and
 * persistence all live elsewhere (`ValidationPipe` + `KudosService`).
 */
@Controller(`${API_V1_PREFIX}/kudos`)
@UseGuards(SessionGuard)
export class KudosController {
  constructor(private readonly kudos: KudosService) {}

  /**
   * `GET /api/v1/kudos?page=N` — newest-first board, 20 per page (ADR-6).
   *
   * `?hidden=true` switches to the lead-only soft-hidden review variant, whose
   * 403-for-a-regular-member check happens in the service.
   */
  @Get()
  async list(
    @CurrentMember() member: AuthenticatedMember,
    @Query("page") page?: string,
    @Query("hidden") hidden?: string,
  ) {
    return this.kudos.list(member, { page, hidden });
  }

  /**
   * `POST /api/v1/kudos` — publish a kudos.
   *
   * Responds **201** with the created kudos in the uniform ADR-7 shape. A body
   * that fails `CreateKudosDto` validation never reaches this handler; the
   * global `ValidationPipe` answers 400 instead (AC-8 / AC-9).
   */
  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateKudosDto,
    @CurrentMember() member: AuthenticatedMember,
  ) {
    return this.kudos.create(member, dto);
  }
}
