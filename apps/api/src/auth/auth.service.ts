import {
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { MemberRole } from "@prisma/client";
import type { Response } from "express";
import { APP_CONFIG, appConfig, type AppConfig } from "@/app.config";
import type { AuthenticatedMember } from "@/common/guards/session.guard";
import {
  hashPassword,
  verifyPassword,
} from "@/common/security/password.util";
import { PrismaService } from "@/prisma/prisma.service";
import type { LoginDto } from "./dto/login.dto";

/**
 * The one and only reason a failed login is ever reported (AC-2 / ADR-1).
 *
 * Deliberately identical for an unknown email and a wrong password so the
 * response cannot be used to enumerate which emails have an account.
 */
export const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";

/** Member fields returned by `POST /api/v1/auth/login`. */
export interface LoginMemberResponse {
  readonly id: string;
  readonly email: string;
  readonly role: MemberRole;
}

/** Body of `GET /api/v1/auth/session` (ADR-1: email + role, nothing else). */
export interface SessionMemberResponse {
  readonly email: string;
  readonly role: MemberRole;
}

/** A freshly issued opaque session plus the member it authenticates. */
export interface IssuedSession {
  /** Opaque session id — the value carried by the httpOnly cookie. */
  readonly sessionId: string;
  /** `now + sessionTtlSeconds`, taken from `app.config`. */
  readonly expiresAt: Date;
  readonly member: LoginMemberResponse;
}

/** Attributes of the session cookie, all sourced from `app.config` (ADR-1). */
export interface SessionCookieSettings {
  readonly name: string;
  readonly path: string;
  readonly maxAgeMs: number;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "lax" | "strict" | "none";
}

/** Bytes of entropy in every generated session id. */
const SESSION_ID_BYTES = 32;

/**
 * Generates an opaque session id.
 *
 * The id is the primary key of the `sessions` row and the cookie value, so it
 * carries no member information at all — 256 bits of hex, unlike a JWT it is a
 * plain reference to server-side state (ADR-1).
 */
const newSessionId = (): string => randomBytes(SESSION_ID_BYTES).toString("hex");

/**
 * Authentication for the Team Kudos Board API (ADR-1 / ADR-2).
 *
 * `login` resolves the member by email, verifies the submitted password against
 * the stored Argon2id hash via the T-3 util, and only then creates the
 * `Session` row. Every failure path — unknown email, wrong password, a hash
 * that cannot be interpreted — collapses into the same generic **401**, and no
 * `Set-Cookie` header is produced, so a failed login leaks nothing.
 */
@Injectable()
export class AuthService {
  /**
   * Cookie attributes for the issued session cookie.
   *
   * Exposed read-only so the controller stays a thin adapter: it calls
   * {@link writeSessionCookie} without knowing where any value comes from.
   */
  readonly sessionCookie: SessionCookieSettings;

  /**
   * Resolved configuration; always sourced from `app.config.ts`.
   *
   * Injected under the `APP_CONFIG` token when the host injector provides it
   * (it does in `AppModule`), and otherwise read from the same typed factory —
   * the identical single source of truth, honouring the `SESSION_*` env vars.
   * This keeps the module self-contained when it is mounted on its own, which
   * is exactly what the e2e spec does.
   */
  private readonly config: AppConfig;

  /**
   * A throwaway hash of a fixed non-password, computed at most once per
   * process, used to equalise the cost of the unknown-email path.
   */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(APP_CONFIG) config?: AppConfig,
  ) {
    this.config = config ?? appConfig();
    this.sessionCookie = {
      name: this.config.sessionCookieName,
      path: "/",
      maxAgeMs: this.config.sessionTtlSeconds * 1000,
      httpOnly: this.config.sessionCookieHttpOnly,
      secure: this.config.sessionCookieSecure,
      sameSite: this.config.sessionCookieSameSite,
    };
  }

  /**
   * Verifies credentials and issues a server-side session (EP-1).
   *
   * @throws {UnauthorizedException} with {@link INVALID_CREDENTIALS_MESSAGE}
   *         when the email is unknown or the password does not verify — the two
   *         cases are indistinguishable from the response.
   */
  async login(dto: LoginDto): Promise<IssuedSession> {
    // The seed normalises emails to lower case on the unique column, so the
    // lookup uses the same normalisation instead of a case-sensitive miss.
    const email = dto.email.trim().toLowerCase();

    const member = await this.prisma.member.findUnique({
      where: { email },
      select: { id: true, email: true, role: true, passwordHash: true },
    });

    if (member === null) {
      // Burn a comparable password verification so the unknown-email path is
      // not measurably cheaper than the wrong-password path.
      await this.verifyAgainstDummyHash(dto.password);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const passwordMatches = await this.verifyPassword(
      dto.password,
      member.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // Only reached with a verified password: create the opaque session row.
    const expiresAt = new Date(
      Date.now() + this.config.sessionTtlSeconds * 1000,
    );
    const session = await this.prisma.session.create({
      data: {
        id: newSessionId(),
        memberId: member.id,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });

    return {
      sessionId: session.id,
      expiresAt: session.expiresAt,
      member: { id: member.id, email: member.email, role: member.role },
    };
  }

  /**
   * Sets the httpOnly, SameSite=Lax session cookie on the login response.
   *
   * Called by the controller with `@Res({ passthrough: true })`, so Nest still
   * serialises the returned body normally. Every attribute comes from
   * {@link sessionCookie}, i.e. ultimately from `app.config` — the controller
   * never hard-codes a cookie name, lifetime or policy (ADR-1).
   *
   * The only place a `Set-Cookie` header is ever produced is *after* a
   * successful password verification, which is what makes "a failed login sets
   * no session cookie" (AC-2) true by construction.
   */
  writeSessionCookie(response: Response, sessionId: string): void {
    const settings = this.sessionCookie;

    response.cookie(settings.name, sessionId, {
      path: settings.path,
      maxAge: settings.maxAgeMs,
      httpOnly: settings.httpOnly,
      secure: settings.secure,
      sameSite: settings.sameSite,
    });
  }

  /**
   * Maps the member resolved by `SessionGuard` onto the
   * `GET /api/v1/auth/session` body: `{ email, role }` (EP-2).
   *
   * `passwordHash` is never in scope — the guard only attaches
   * `{ id, email, role }` — so the response cannot leak a hash even by
   * accident.
   */
  currentSession(
    member: AuthenticatedMember | undefined,
  ): SessionMemberResponse {
    if (member === undefined) {
      // Unreachable on a route guarded by `SessionGuard`; kept so a miswired
      // route fails closed with 401 instead of serialising `undefined`.
      throw new UnauthorizedException();
    }

    return { email: member.email, role: member.role };
  }

  /**
   * Verifies a submitted password, mapping every uninterpretable stored hash to
   * "does not match".
   *
   * A hash we cannot read can never authenticate anyone; reporting it as the
   * generic credential failure (rather than a 500) keeps the login endpoint
   * from disclosing *why* a specific account failed.
   */
  private async verifyPassword(plain: string, hash: string): Promise<boolean> {
    try {
      return await verifyPassword(plain, hash);
    } catch {
      return false;
    }
  }

  /**
   * Runs one password verification against a throwaway hash.
   *
   * Always returns `false`; the point is only to spend the same CPU on an
   * unknown email as on a wrong password, closing the timing side channel of
   * account enumeration.
   */
  private async verifyAgainstDummyHash(plain: string): Promise<boolean> {
    this.dummyHash ??= hashPassword("not-a-real-account-password");
    const hash = await this.dummyHash;
    return this.verifyPassword(plain, hash);
  }
}
