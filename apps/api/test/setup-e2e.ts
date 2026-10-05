/**
 * Jest `setupFiles` hook: runs once per test worker *before* any spec module is
 * imported, so configuration defaults are in place before Prisma / Nest
 * containers are created.
 *
 * Defaults mirror `src/app.config.ts` and are only applied when the variable is
 * not already set, so CI can override anything with real env vars.
 * No `.env` file is created or read.
 */

// Matches the `postgres` service in docker-compose.yml (kudos/kudos@localhost:5432/kudos).
process.env.DATABASE_URL ??= "postgresql://kudos:kudos@localhost:5432/kudos?schema=public";

// Session cookie defaults (ADR-1: httpOnly session cookie).
process.env.SESSION_COOKIE_NAME ??= "kudos_session";
process.env.SESSION_TTL_SECONDS ??= String(60 * 60 * 12);

// Seeded accounts (ADR-2: accounts are seeded, there is no self-signup).
process.env.SEED_LEAD_EMAIL ??= "lead@kudos.local";
process.env.SEED_LEAD_PASSWORD ??= "lead-password-123";
process.env.SEED_MEMBER_EMAIL ??= "member@kudos.local";
process.env.SEED_MEMBER_PASSWORD ??= "member-password-123";

export {};
