import {
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { MemberRole } from "@prisma/client";
import type { Request } from "express";
import { APP_CONFIG, appConfig, type AppConfig } from "@/app.config";
import { PrismaService } from "@/prisma/prisma.service";

/**
 * The authenticated member attached to a request by {@link SessionGuard}.
 *
 * Deliberately narrow: `passwordHash` is never part of it, so no guarded
 * handler can leak a hash by serialising the member it was handed.
 */
export interface AuthenticatedMember {
  readonly id: string;
  readonly email: string;
  readonly role: MemberRole;
}

/**
 * An Express request that may carry the authenticated member.
 *
 * `member` is only ever set by {@link SessionGuard}; a route without that
 * guard sees `undefined`.
 */
export interface AuthenticatedRequest extends Request {
  member?: AuthenticatedMember;
}

/**
 * Session-cookie authentication for the whole API (ADR-1).
 *
 * Reads the opaque session id from the httpOnly session cookie (name from
 * `app.config`), resolves the `Session` row plus its `Member` through
 * `PrismaService`, and rejects with **401** when the cookie is missing,
 * unknown, or expired (`expiresAt` in the past). On success the member
 * `{ id, email, role }` is attached to `request.member` so downstream guards
 * and `@CurrentMember()` never re-query the session.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  /**
   * Resolved configuration; always sourced from `app.config.ts`.
   *
   * The `APP_CONFIG` token is provided by `AppModule`, which feature modules
   * do not import, so the injection is optional and falls back to the typed
   * `appConfig()` factory — the same single source of truth, still honouring
   * `SESSION_COOKIE_NAME` from the environment. A guard must never fail to
   * boot merely because of where it was registered.
   */
  private readonly config: AppConfig;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(APP_CONFIG) config?: AppConfig,
  ) {
    this.config = config ?? appConfig();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const sessionId = this.readSessionId(request);
    if (sessionId === undefined) {
      throw new UnauthorizedException("Missing session cookie");
    }

    // The session id is the opaque primary key of the `sessions` table, so a
    // single indexed lookup resolves both the session and its member.
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        expiresAt: true,
        member: { select: { id: true, email: true, role: true } },
      },
    });

    if (session === null) {
      throw new UnauthorizedException("Unknown session");
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("Session expired");
    }

    if (session.member === null) {
      // Unreachable while `Session.memberId` is a required FK, but a dangling
      // session must never authenticate a request.
      throw new UnauthorizedException("Session has no member");
    }

    request.member = {
      id: session.member.id,
      email: session.member.email,
      role: session.member.role,
    };

    return true;
  }

  /**
   * Resolves the session cookie value for the configured cookie name.
   *
   * Prefers `request.cookies` when the `cookie-parser` middleware has already
   * run, and otherwise parses the raw `Cookie` header itself. Keeping a local
   * parser means this guard is correct without depending on `main.ts`
   * registering any middleware.
   */
  private readSessionId(request: AuthenticatedRequest): string | undefined {
    const name = this.config.sessionCookieName;

    const parsedCookies = request.cookies as Record<string, string> | undefined;
    const fromParser =
      parsedCookies === undefined ? undefined : parsedCookies[name];
    if (typeof fromParser === "string" && fromParser !== "") {
      return fromParser;
    }

    return readCookieFromHeader(request.headers.cookie, name);
  }
}

/**
 * Minimal RFC 6265 cookie-header reader for a single name.
 *
 * Session ids are opaque tokens (never `=` or `;`), so splitting on the first
 * `=` per cookie-pair is sufficient and never mis-reads a value.
 */
export const readCookieFromHeader = (
  headerValue: string | undefined,
  name: string,
): string | undefined => {
  if (headerValue === undefined || headerValue === "") {
    return undefined;
  }

  for (const cookiePair of headerValue.split(";")) {
    const separatorIndex = cookiePair.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const cookieName = cookiePair.slice(0, separatorIndex).trim();
    if (cookieName !== name) {
      continue;
    }

    const rawValue = cookiePair.slice(separatorIndex + 1).trim();
    if (rawValue === "") {
      return undefined;
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      // A malformed escape sequence is not a session id we issued.
      return rawValue;
    }
  }

  return undefined;
};
