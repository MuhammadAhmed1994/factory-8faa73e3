/**
 * Typed application configuration factory.
 *
 * This module is deliberately dependency-free: `main.ts`, jest specs and the
 * Prisma seed script all import it, so it must load before (and regardless of)
 * any Nest container. Real environment variables always win; otherwise the safe
 * defaults below apply. No `.env` file is created or read.
 */

/** Seeded account credentials (ADR-2: accounts are seeded, there is no self-signup). */
export interface SeedCredentials {
  readonly email: string;
  readonly password: string;
}

/** The shape exposed to the rest of the app. */
export interface AppConfig {
  /** PostgreSQL connection string; default points at the docker-compose service. */
  readonly databaseUrl: string;
  /** Port the HTTP listener binds to. */
  readonly port: number;
  /** Name of the httpOnly session cookie (ADR-1). */
  readonly sessionCookieName: string;
  /** Session lifetime in seconds (ADR-1). */
  readonly sessionTtlSeconds: number;
  /** Credentials of the seeded team lead (role = LEAD). */
  readonly seedLead: SeedCredentials;
  /** Credentials of the seeded regular member (role = MEMBER). */
  readonly seedMember: SeedCredentials;
}

/** Injection token for the resolved config, e.g. `@Inject(APP_CONFIG)`. */
export const APP_CONFIG = Symbol("APP_CONFIG");

/** Defaults mirrored by `test/setup-e2e.ts` so specs and app agree. */
export const DEFAULT_DATABASE_URL =
  "postgresql://kudos:kudos@localhost:5432/kudos?schema=public";
export const DEFAULT_PORT = 3000;
export const DEFAULT_SESSION_COOKIE_NAME = "kudos_session";
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h
export const DEFAULT_SEED_LEAD_EMAIL = "lead@kudos.local";
export const DEFAULT_SEED_LEAD_PASSWORD = "lead-password-123";
export const DEFAULT_SEED_MEMBER_EMAIL = "member@kudos.local";
export const DEFAULT_SEED_MEMBER_PASSWORD = "member-password-123";

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim() !== "" ? value : fallback;
}

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Reads the effective config from the environment, falling back to safe defaults. */
export function loadAppConfig(): AppConfig {
  return {
    databaseUrl: envString("DATABASE_URL", DEFAULT_DATABASE_URL),
    port: envPositiveInt("PORT", DEFAULT_PORT),
    sessionCookieName: envString("SESSION_COOKIE_NAME", DEFAULT_SESSION_COOKIE_NAME),
    sessionTtlSeconds: envPositiveInt("SESSION_TTL_SECONDS", DEFAULT_SESSION_TTL_SECONDS),
    seedLead: {
      email: envString("SEED_LEAD_EMAIL", DEFAULT_SEED_LEAD_EMAIL),
      password: envString("SEED_LEAD_PASSWORD", DEFAULT_SEED_LEAD_PASSWORD),
    },
    seedMember: {
      email: envString("SEED_MEMBER_EMAIL", DEFAULT_SEED_MEMBER_EMAIL),
      password: envString("SEED_MEMBER_PASSWORD", DEFAULT_SEED_MEMBER_PASSWORD),
    },
  };
}
