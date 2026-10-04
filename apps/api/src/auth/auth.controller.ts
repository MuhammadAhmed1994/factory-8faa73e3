import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import type { AuthenticatedMember } from "@/common/guards/session.guard";
import { SessionGuard } from "@/common/guards/session.guard";
import { CurrentMember } from "@/common/decorators/current-member.decorator";
import { AuthService } from "./auth.service";
import type {
  LoginMemberResponse,
  SessionMemberResponse,
} from "./auth.service";
// Value import (NOT `import type`): the emitted `design:paramtypes` metadata
// must reference the LoginDto *class* at runtime, or the global ValidationPipe
// cannot see its class-validator decorators and rejects every body.
import { LoginDto } from "./dto/login.dto";

/**
 * Auth endpoints (EP-1 / EP-2, ADR-1).
 *
 * The controller is deliberately thin: it binds the validated `LoginDto`,
 * delegates every decision to {@link AuthService}, and returns the shape the
 * product contract fixes. Session-cookie attributes all come from the service
 * (which reads them from `app.config`), so no configuration is duplicated here.
 *
 * The `/api/v1` prefix is declared on the controller rather than through a
 * global prefix, so the routes resolve identically whether the module is
 * mounted by `main.ts`'s `AppModule` or by a testing module in a spec.
 */
@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * `POST /api/v1/auth/login` → **200** `{ id, email, role }` + `Set-Cookie`.
   *
   * A malformed body never reaches this handler: the global `ValidationPipe`
   * rejects it with 400. Unknown email or wrong password is turned into a
   * single generic 401 by the service, which also means no `Set-Cookie` header
   * is produced for a failed login (AC-2).
   */
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginMemberResponse> {
    const issued = await this.authService.login(dto);

    // httpOnly + SameSite=Lax opaque session cookie (ADR-1); every attribute
    // is resolved from `app.config` inside the service.
    this.authService.writeSessionCookie(response, issued.sessionId);

    return {
      id: issued.member.id,
      email: issued.member.email,
      role: issued.member.role,
    };
  }

  /**
   * `GET /api/v1/auth/session` → **200** `{ email, role }` for the member the
   * session cookie resolves to.
   *
   * `SessionGuard` rejects with 401 when the cookie is missing, unknown or
   * expired; on success it attaches `{ id, email, role }`, which
   * `@CurrentMember()` binds here.
   */
  @Get("session")
  @UseGuards(SessionGuard)
  session(
    @CurrentMember() member: AuthenticatedMember,
  ): SessionMemberResponse {
    return this.authService.currentSession(member);
  }
}
