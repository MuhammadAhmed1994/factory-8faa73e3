import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { CurrentMember } from "../common/decorators/current-member.decorator";
import { SessionGuard, type AuthenticatedMember } from "../common/guards/session.guard";
import { CreateKudosDto, ListKudosQueryDto } from "./dto/create-kudos.dto";
import { KudosService } from "./kudos.service";

/**
 * Thin routing layer for the kudos board (EP-3 / EP-4).
 *
 * Every decision lives elsewhere: authentication in `SessionGuard`, payload
 * validation in the DTOs, queries and rules in `KudosService`, and the response
 * shape in `kudos.serializer.ts`. The handlers only adapt HTTP to the service.
 *
 * The `api/v1` prefix is declared here rather than via `setGlobalPrefix()`
 * because this module owns its route table: the path is then correct no matter
 * how the host application is bootstrapped.
 */
@Controller("api/v1/kudos")
@UseGuards(SessionGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    errorHttpStatusCode: HttpStatus.BAD_REQUEST,
  }),
)
export class KudosController {
  constructor(private readonly kudos: KudosService) {}

  /**
   * `GET /api/v1/kudos` - one page of the visible board, newest first, 20 per
   * page (ADR-6). `?page=N` (default 1) pages through it.
   *
   * `?hidden=true` switches to the lead-only review variant: the soft-hidden
   * kudos in the standard shape plus `hiddenAt`/`hiddenBy`. A MEMBER session is
   * answered 403 by the service (ADR-5).
   */
  @Get()
  async list(
    @CurrentMember() member: AuthenticatedMember,
    @Query() query: ListKudosQueryDto,
  ) {
    if (query.hidden === "true") {
      return this.kudos.listHiddenForMember(member, query);
    }
    return this.kudos.listBoardForMember(member, query);
  }

  /**
   * `POST /api/v1/kudos` - posts one kudos (EP-4).
   *
   * Answers **201** with the created kudos in the uniform shape (AC-6). An
   * invalid body never reaches this handler: the DTO + pipe answer **400**
   * first (AC-8 / AC-9).
   */
  @Post()
  async create(
    @CurrentMember() member: AuthenticatedMember,
    @Body() dto: CreateKudosDto,
  ) {
    return this.kudos.create(member, dto);
  }
}
