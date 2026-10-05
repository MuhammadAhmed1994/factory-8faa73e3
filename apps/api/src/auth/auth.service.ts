import {
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { MemberRole } from "@prisma/client";
import { APP_CONFIG, loadAppConfig, type AppConfig } from "../app.config";
import { verifyPassword } from "../common/security/password.util";
import { PrismaService } from "../prisma/prisma.service";
import type { LoginDto } from "./dto/login.dto";

/**
 * The single failure message for every bad login (EP-1).
 *
 * A wrong password, an unknown email and a malformed-but-parseable credential
 * all answer with exactly this string, so the response leaks nothing about
 * which accounts exist (no user enumeration).
 */
export const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";

/** Entropy of the opaque session token: 32 bytes = 256 bits. */
const SESSION_ID_BYTES = 32;

/** A member as login is allowed to report it - never the password hash. */
export interface AuthenticatedMemberSnapshot {
  readonly id: string;
  readonly email: string;
  readonly role: MemberRole;
}

/** What a successful login produces: the member plus its server-side session. */
export interface LoginResult {
  readonly member: AuthenticatedMemberSnapshot;
  readonly session: {
    readonly id: string;
    readonly expiresAt: Date;
  };
}

/**
 * Mints an opaque session id (ADR-1).
 *
 * Random, url-safe and unguessable - deliberately *not* a cuid, because the
 * value is a bearer credential: a sequential-ish identifier would make session
 * guessing feasible. Nothing about the member is encoded in it; the server-side
 * `Session` row is the only place that maps id -> member.
 */
export function createSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString("base64url");
}

/**
 * Sign-in use case (ADR-1 / ADR-2).
 *
 * Flow: look the seeded member up by email, verify the submitted password
 * against its stored Argon2id hash through the T-3 funnel, and only then create
 * the `Session` row (`expiresAt` = now + the configured TTL). Everything that
 * can be answered "no" - unknown email, wrong password, unverifiable hash -
 * surfaces as one generic 401, and no `Session` row is written on any of them.
 */
@Injectable()
export class AuthService {
  private readonly config: AppConfig;

  constructor(
    private readonly prisma: PrismaService,
    // Same wiring contract as `SessionGuard`: `@Inject(APP_CONFIG)` when the
    // injector can see it (the module provides it), otherwise the identical
    // env-driven value. Feature specs may therefore mount this module alone.
    @Optional() @Inject(APP_CONFIG) config?: AppConfig,
  ) {
    this.config = config ?? loadAppConfig();
  }

  /** Cookie name carrying the session id (ADR-1), from `app.config`. */
  get sessionCookieName(): string {
    return this.config.sessionCookieName;
  }

  /** Session lifetime in seconds, from `app.config`. */
  get sessionTtlSeconds(): number {
    return this.config.sessionTtlSeconds;
  }

  /** `expiresAt` of a session created at `now`. */
  sessionExpiresAt(now: Date = new Date()): Date {
    return new Date(now.getTime() + this.config.sessionTtlSeconds * 1000);
  }

  /**
   * Verifies the credentials and opens a session.
   *
   * @throws `UnauthorizedException` with {@link INVALID_CREDENTIALS_MESSAGE}
   *   for an unknown email or a wrong password - and for nothing else: a
   *   database problem propagates as itself instead of masquerading as a bad
   *   credential.
   */
  async login(dto: LoginDto): Promise<LoginResult> {
    const member = await this.findMemberByEmail(dto.email);

    if (member === null) {
      // Unknown email: same generic answer as a wrong password.
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // T-3 funnel: Argon2id (bcrypt cost 12 fallback). The plaintext stays in
    // this call frame; only the boolean comes back.
    const verified = await verifyPassword(dto.password, member.passwordHash);

    if (!verified) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const session = await this.prisma.session.create({
      data: {
        id: createSessionId(),
        memberId: member.id,
        expiresAt: this.sessionExpiresAt(),
      },
    });

    return {
      member: {
        id: member.id,
        email: member.email,
        role: member.role,
      },
      session: { id: session.id, expiresAt: session.expiresAt },
    };
  }

  /**
   * Resolves the login email to a member row.
   *
   * Case-insensitive: the seed roster is the source of truth for exact
   * addresses, so `Member@Kudos.local` must not lock a seeded account out, and
   * an email that matches nothing still yields `null` (-> generic 401).
   */
  private async findMemberByEmail(
    email: string,
  ): Promise<{
    id: string;
    email: string;
    role: MemberRole;
    passwordHash: string;
  } | null> {
    const trimmed = email.trim();
    if (trimmed === "") {
      return null;
    }

    return this.prisma.member.findFirst({
      where: { email: { equals: trimmed, mode: "insensitive" } },
    });
  }
}
