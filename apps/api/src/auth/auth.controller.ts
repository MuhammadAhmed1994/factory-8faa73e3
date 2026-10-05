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
import type { MemberRole } from "@prisma/client";
import type { Response } from "express";
import { CurrentMember } from "../common/decorators/current-member.decorator";
import {
  AuthenticatedMember,
  SessionGuard,
} from "../common/guards/session.guard";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";

/**
 * Auth routes (ADR-1).
 *
 * EP-1 `POST /api/v1/auth/login` - verifies the credentials, creates the
 * server-side session row and writes the httpOnly cookie.
 * EP-2 `GET /api/v1/auth/session` - reads back the signed-in member so the web
 * app can render their email and role.
 *
 * The controller stays thin: it translates between HTTP and the service, and
 * every body-shape rule lives in `LoginDto` so the `ValidationPipe` can reject
 * a malformed request with 400 before this class is ever entered.
 */
@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Issues the session cookie (EP-1).
   *
   * On success the response is 200 with `{ id, email, role }` plus the
   * `Set-Cookie` header. On failure the service throws `UnauthorizedException`
   * **before** any cookie is written, so the 401 response carries no
   * `Set-Cookie` header at all (AC-2).
   *
   * `@Res({ passthrough: true })` keeps the Nest response pipeline (status
   * code, serialization) in charge while still letting this handler add the
   * `Set-Cookie` header.
   */
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string; email: string; role: MemberRole }> {
    // Throws 401 for an unknown email or a wrong password; nothing is written
    // to the response in that case, so no cookie can leak out.
    const { member, session } = await this.authService.login(dto);

    // httpOnly so no script can read the session id; SameSite=Lax so the cookie
    // rides along on top-level navigations from the web app but not on
    // cross-site POSTs. `path: "/"` because the whole API lives behind it.
    res.cookie(this.authService.sessionCookieName, session.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: this.authService.sessionTtlSeconds * 1000,
    });

    return { id: member.id, email: member.email, role: member.role };
  }

  /**
   * Who is signed in (EP-2).
   *
   * `SessionGuard` resolves the cookie and 401s on a missing, unknown or
   * expired session; `@CurrentMember()` then hands the handler the member the
   * guard already loaded, so this route never queries the database itself.
   */
  @Get("session")
  @UseGuards(SessionGuard)
  session(@CurrentMember() member: AuthenticatedMember) {
    return { email: member.email, role: member.role };
  }
}
