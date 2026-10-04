/**
 * Typed application configuration for the Team Kudos Board API.
 *
 * This module is the single source of truth for configuration values and their
 * safe defaults. No `.env` file is created anywhere in the repo — defaults live
 * here, and every value can be overridden through the environment.
 *
 * `appConfig` is a plain typed factory registered as a provider in `AppModule`
 * under the `APP_CONFIG` token (see `app.module.ts`), so any module can inject
 * the strongly-typed `AppConfig` without depending on a config library.
 */
import type { INestApplicationContext } from "@nestjs/common";

/** Lead/member accounts seeded at deploy time (no self-signup: ADR-2 / Q-5). */
export interface SeedAccount {
  readonly email: string;
  readonly password: string;
  readonly role: MemberRole;
}

export type MemberRole = "MEMBER" | "LEAD";

/** The four curated reaction emojis (ADR-4 / Q-3). */
export const REACTION_EMOJIS = ["👍", "❤️", "🎉", "🙌"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/** Maximum length of a kudos message (constraint C-2). */
export const KUDOS_MESSAGE_MAX_LENGTH = 280;

/** Board page size, newest first (constraint C-3 / ADR-6). */
export const KUDOS_PAGE_SIZE = 20;

/** Board refresh interval in ms (ADR-3: 15s polling). */
export const BOARD_POLL_INTERVAL_MS = 15_000;

export interface AppConfig {
  /** Postgres connection string (docker-compose service `postgres`). */
  readonly databaseUrl: string;
  /** HTTP port the API listens on. */
  readonly port: number;
  /** Name of the httpOnly session cookie (ADR-1). */
  readonly sessionCookieName: string;
  /** Session lifetime in seconds; sessions are opaque server-side rows. */
  readonly sessionTtlSeconds: number;
  /** Whether the session cookie is sent only over HTTPS. */
  readonly sessionCookieSecure: boolean;
  /** Whether the session cookie is readable from browser JS (always false). */
  readonly sessionCookieHttpOnly: boolean;
  /** SameSite policy of the session cookie. */
  readonly sessionCookieSameSite: "lax" | "strict" | "none";
  /** Lead/member accounts the seed task inserts (ADR-2). */
  readonly seedAccounts: readonly SeedAccount[];
}

/** Injection token for the resolved `AppConfig`. */
export const APP_CONFIG = Symbol("APP_CONFIG");

function readString(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): string {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  return raw.trim();
}

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: boolean,
): boolean {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  return raw.trim().toLowerCase() === "true";
}

/** Default accounts: one team lead + one regular member of the single team. */
export const DEFAULT_SEED_ACCOUNTS: readonly SeedAccount[] = [
  { email: "lead@kudos.local", password: "[REDACTED]", role: "LEAD" },
  {
    email: "member@kudos.local",
    password: "[REDACTED]",
    role: "MEMBER",
  },
];

/** Matches the `postgres` service in the repo-root `docker-compose.yml`. */
export const DEFAULT_DATABASE_URL =
  "postgresql://kudos:kudos@localhost:5432/kudos?schema=public";

export const DEFAULT_PORT = 3000;
export const DEFAULT_SESSION_COOKIE_NAME = "kudos_session";
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Typed config factory. Reads the environment once and falls back to the safe
 * defaults declared above, so the app always boots without a `.env` file.
 */
export const appConfig = (): AppConfig => ({
  databaseUrl: readString(process.env, "DATABASE_URL", DEFAULT_DATABASE_URL),
  port: readInt(process.env, "PORT", DEFAULT_PORT),
  sessionCookieName: readString(
    process.env,
    "SESSION_COOKIE_NAME",
    DEFAULT_SESSION_COOKIE_NAME,
  ),
  sessionTtlSeconds: readInt(
    process.env,
    "SESSION_TTL_SECONDS",
    DEFAULT_SESSION_TTL_SECONDS,
  ),
  sessionCookieSecure: readBool(process.env, "SESSION_COOKIE_SECURE", false),
  sessionCookieHttpOnly: readBool(process.env, "SESSION_COOKIE_HTTP_ONLY", true),
  sessionCookieSameSite: "lax",
  seedAccounts: DEFAULT_SEED_ACCOUNTS,
});

export default appConfig;

/** Convenience accessor for the typed config from any initialized Nest app. */
export const getAppConfig = (app: INestApplicationContext): AppConfig => {
  const config = app.get<AppConfig>(APP_CONFIG, { strict: false });
  return config ?? appConfig();
};
