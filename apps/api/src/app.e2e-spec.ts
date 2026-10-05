import { AppModule } from "./app.module";
import {
  APP_CONFIG,
  DEFAULT_DATABASE_URL,
  DEFAULT_SESSION_COOKIE_NAME,
  loadAppConfig,
} from "./app.config";

/**
 * Scaffold spec for the API package.
 *
 * It needs no database: it proves the jest pipeline runs, that
 * `test/setup-e2e.ts` applies env defaults before any spec module loads, that
 * the typed config factory exposes safe defaults, and that `AppModule` (and
 * therefore `main.ts`) compiles and wires the config provider.
 */
describe("[T-1] scaffold: env defaults, typed config and app wiring", () => {
  it("[T-1] setup-e2e guarantees a DATABASE_URL before specs load", () => {
    // The setup file only fills in the compose default when the variable is
    // unset, so an externally provided DATABASE_URL (as CI does) must survive.
    expect(typeof process.env.DATABASE_URL).toBe("string");
    expect(process.env.DATABASE_URL).not.toBe("");
    expect(loadAppConfig().databaseUrl).toBe(process.env.DATABASE_URL);
    expect(DEFAULT_DATABASE_URL).toBe(
      "postgresql://kudos:kudos@localhost:5432/kudos?schema=public",
    );
  });

  it("[T-1] setup-e2e applies the session and seed env defaults", () => {
    expect(process.env.SESSION_COOKIE_NAME ?? DEFAULT_SESSION_COOKIE_NAME).toBe(
      DEFAULT_SESSION_COOKIE_NAME,
    );
    expect(process.env.SESSION_TTL_SECONDS ?? String(60 * 60 * 12)).toBe(
      String(60 * 60 * 12),
    );
  });

  it("[T-1] loadAppConfig exposes DATABASE_URL, PORT, cookie name, TTL and seed credentials", () => {
    const config = loadAppConfig();

    expect(config.databaseUrl).toBe(process.env.DATABASE_URL);
    expect(config.port).toBe(Number(process.env.PORT ?? 3000));
    expect(config.sessionCookieName).toBe(
      process.env.SESSION_COOKIE_NAME ?? DEFAULT_SESSION_COOKIE_NAME,
    );
    expect(config.sessionTtlSeconds).toBe(60 * 60 * 12);
    expect(config.seedLead).toEqual({
      email: "lead@kudos.local",
      password: "lead-password-123",
    });
    expect(config.seedMember).toEqual({
      email: "member@kudos.local",
      password: "member-password-123",
    });
  });

  it("[T-1] explicit environment variables override the defaults", () => {
    const previousPort = process.env.PORT;
    const previousCookie = process.env.SESSION_COOKIE_NAME;
    try {
      process.env.PORT = "4001";
      process.env.SESSION_COOKIE_NAME = "other_cookie";
      const config = loadAppConfig();
      expect(config.port).toBe(4001);
      expect(config.sessionCookieName).toBe("other_cookie");
    } finally {
      if (previousPort === undefined) delete process.env.PORT;
      else process.env.PORT = previousPort;
      if (previousCookie === undefined) delete process.env.SESSION_COOKIE_NAME;
      else process.env.SESSION_COOKIE_NAME = previousCookie;
    }
  });

  it("[T-1] every AppConfig key is present at runtime", () => {
    const config = loadAppConfig();
    const keys: Array<keyof typeof config> = [
      "databaseUrl",
      "port",
      "sessionCookieName",
      "sessionTtlSeconds",
      "seedLead",
      "seedMember",
    ];
    expect(keys.map((key) => [key, config[key] !== undefined])).toEqual(
      keys.map((key) => [key, true]),
    );
  });

  it("[T-1] AppModule compiles and publishes the config provider", () => {
    expect(AppModule).toBeDefined();
    expect(typeof APP_CONFIG).toBe("symbol");
  });
});
