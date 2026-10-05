import {
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { MemberRole } from "@prisma/client";
import { APP_CONFIG, loadAppConfig, type AppConfig } from "../../app.config";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * The authenticated caller attached to the request by `SessionGuard`.
 *
 * Deliberately tiny - `{ id, email, role }` and nothing else. `passwordHash`
 * never leaves the database, so it cannot leak into a response payload or a
 * log line by accident.
 */
export interface AuthenticatedMember {
  readonly id: string;
  readonly email: string;
  readonly role: MemberRole;
}

/**
 * The slice of an incoming HTTP request this plumbing touches.
 *
 * Kept local (rather than importing express's `Request`) so the guard depends
 * on nothing but `@nestjs/common`. `cookies` is populated when `cookie-parser`
 * is mounted; the raw `Cookie` header is also read, so the guard keeps working
 * before that middleware is wired up.
 */
export interface RequestWithMember {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly cookies?: Record<string, string | undefined>;
  member?: AuthenticatedMember;
}

/**
 * Decodes one `name=value` pair out of a `Cookie` request header.
 *
 * Hand-rolled because `cookie-parser` is not mounted in `main.ts`; this keeps
 * the guard self-sufficient and free of middleware-order assumptions. The value
 * is trimmed, optional surrounding quotes are stripped and percent-encoding is
 * undone - matching what `res.cookie()` writes.
 */
function readCookieHeader(header: string, name: string): string | undefined {
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }
    if (part.slice(0, separator).trim() !== name) {
      continue;
    }
    let value = part.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      value = decodeURIComponent(value);
    } catch {
      // A value that is not valid percent-encoding is used as-is.
    }
    return value === "" ? undefined : value;
  }
  return undefined;
}

/**
 * Resolves the httpOnly session cookie into an authenticated member (ADR-1).
 *
 * Every kudos, reaction and moderation route is protected by this guard. It
 * reads the opaque session id from the cookie whose name comes from
 * `app.config`, loads the `Session` row **plus its `Member`** in one query, and
 * rejects the request with **401** when the cookie is missing, unknown or
 * expired. On success the resolved member is attached as `request.member`, so
 * controllers and downstream guards never re-query the session.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly config: AppConfig;

  constructor(
    private readonly prisma: PrismaService,
    // `@Optional()` keeps the guard usable from any wiring: as `APP_GUARD`
    // (resolved where `APP_CONFIG` lives) or inline via
    // `@UseGuards(SessionGuard)` on a feature-module controller, whose injector
    // cannot see a non-global root-module provider. In the latter case the same
    // env-driven factory supplies an identical value.
    @Optional() @Inject(APP_CONFIG) config?: AppConfig,
  ) {
    this.config = config ?? loadAppConfig();
  }

  /** Cookie name used for the session (ADR-1), exposed for tests and logout. */
  get sessionCookieName(): string {
    return this.config.sessionCookieName;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithMember>();
    const sessionId = this.readSessionId(request);

    if (sessionId === undefined) {
      // No cookie at all - the caller is not authenticated (AC-3).
      throw new UnauthorizedException("Authentication required.");
    }

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { member: true },
    });

    if (session === null) {
      throw new UnauthorizedException("Invalid session.");
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("Session expired.");
    }

    request.member = {
      id: session.member.id,
      email: session.member.email,
      role: session.member.role,
    };

    return true;
  }

  /**
   * Reads the opaque session id, preferring `cookie-parser`'s parsed map and
   * falling back to the raw `Cookie` header.
   */
  private readSessionId(request: RequestWithMember): string | undefined {
    const cookieName = this.config.sessionCookieName;

    const parsed = request.cookies?.[cookieName];
    if (typeof parsed === "string" && parsed !== "") {
      return parsed;
    }

    const header = request.headers.cookie;
    if (typeof header !== "string" || header === "") {
      return undefined;
    }

    return readCookieHeader(header, cookieName);
  }
}
