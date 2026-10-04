import {
  appConfig,
  DEFAULT_DATABASE_URL,
  DEFAULT_PORT,
  DEFAULT_SEED_ACCOUNTS,
  DEFAULT_SESSION_COOKIE_NAME,
  DEFAULT_SESSION_TTL_SECONDS,
  KUDOS_MESSAGE_MAX_LENGTH,
  KUDOS_PAGE_SIZE,
  REACTION_EMOJIS,
  type AppConfig,
} from "./app.config";

/**
 * Unit spec for the typed config factory in `src/app.config.ts`.
 *
 * Covers the scaffold's own contract: safe defaults with no `.env` file,
 * environment overrides winning when present, and the product constants the
 * later feature tasks rely on.
 */
describe("appConfig (typed config factory)", () => {
  const ORIGINAL_ENV: NodeJS.ProcessEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns safe defaults when the environment is empty", () => {
    delete process.env.DATABASE_URL;
    delete process.env.PORT;
    delete process.env.SESSION_COOKIE_NAME;
    delete process.env.SESSION_TTL_SECONDS;
    delete process.env.SESSION_COOKIE_SECURE;
    delete process.env.SESSION_COOKIE_HTTP_ONLY;

    const config: AppConfig = appConfig();

    expect(config.databaseUrl).toBe(DEFAULT_DATABASE_URL);
    expect(config.databaseUrl).toBe(
      "postgresql://kudos:kudos@localhost:5432/kudos?schema=public",
    );
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.port).toBe(3000);
    expect(config.sessionCookieName).toBe(DEFAULT_SESSION_COOKIE_NAME);
    expect(config.sessionCookieName).toBe("kudos_session");
    expect(config.sessionTtlSeconds).toBe(DEFAULT_SESSION_TTL_SECONDS);
    expect(config.sessionTtlSeconds).toBe(604800);
    expect(config.sessionCookieHttpOnly).toBe(true);
    expect(config.sessionCookieSecure).toBe(false);
    expect(config.sessionCookieSameSite).toBe("lax");
  });

  it("exposes one lead and one member seed account with credentials", () => {
    const config = appConfig();

    expect(config.seedAccounts).toHaveLength(2);
    const roles = config.seedAccounts.map((account) => account.role).sort();
    expect(roles).toEqual(["LEAD", "MEMBER"]);

    for (const account of config.seedAccounts) {
      expect(account.email).toMatch(/^[^@\s]+@[^@\s]+$/);
      expect(account.password.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_SEED_ACCOUNTS).toEqual(config.seedAccounts);
  });

  it("prefers environment variables over the defaults", () => {
    process.env.DATABASE_URL = "postgresql://override:5432/other";
    process.env.PORT = "4000";
    process.env.SESSION_COOKIE_NAME = "other_cookie";
    process.env.SESSION_TTL_SECONDS = "60";

    const config = appConfig();

    expect(config.databaseUrl).toBe("postgresql://override:5432/other");
    expect(config.port).toBe(4000);
    expect(config.sessionCookieName).toBe("other_cookie");
    expect(config.sessionTtlSeconds).toBe(60);
  });

  it("falls back to defaults for malformed numeric input", () => {
    process.env.PORT = "not-a-number";
    process.env.SESSION_TTL_SECONDS = "";

    const config = appConfig();

    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.sessionTtlSeconds).toBe(DEFAULT_SESSION_TTL_SECONDS);
  });

  it("exports the product constants the feature tasks build on", () => {
    expect(KUDOS_MESSAGE_MAX_LENGTH).toBe(280);
    expect(KUDOS_PAGE_SIZE).toBe(20);
    expect([...REACTION_EMOJIS]).toEqual(["👍", "❤️", "🎉", "🙌"]);
  });
});
