/**
 * Jest `setupFiles` hook for the API package.
 *
 * It runs before the test framework and before any spec module is imported, so
 * every spec (unit + e2e) sees the same environment defaults. No `.env` file is
 * created anywhere in the repo — defaults live here and in `src/app.config.ts`.
 *
 * The postgres URL matches the service in `docker-compose.yml` at the repo root:
 *   user `kudos`, password `kudos`, database `kudos`, port 5432.
 */

const COMPOSE_DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://kudos:kudos@localhost:5432/kudos?schema=public";

process.env.DATABASE_URL = COMPOSE_DATABASE_URL;

if (!process.env.PORT) {
  process.env.PORT = "3000";
}

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

export {};
