import {
  Controller,
  Get,
  UseGuards,
  ValidationPipe,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { appConfig, type SeedAccount } from "@/app.config";
import { CurrentMember } from "@/common/decorators/current-member.decorator";
import {
  SessionGuard,
  type AuthenticatedMember,
} from "@/common/guards/session.guard";
import { hashPassword } from "@/common/security/password.util";
import { PrismaModule } from "@/prisma/prisma.module";
import { PrismaService } from "@/prisma/prisma.service";
import { AuthModule } from "./auth.module";

/**
 * E2E spec for the auth module (EP-1 `POST /api/v1/auth/login`, EP-2
 * `GET /api/v1/auth/session`) against the real PostgreSQL from the repo-root
 * `docker-compose.yml`.
 *
 * Per the e2e convention this spec imports only `AuthModule` plus the
 * Prisma/guard foundation modules — **not** `AppModule` and **not** the kudos
 * feature module. `GET /api/v1/kudos` (owned by a later task) is therefore
 * stood in for by {@link GuardedBoardProbeController}: a minimal route guarded
 * by the very same `SessionGuard` every board endpoint uses, which is precisely
 * what AC-1's "the cookie authenticates a subsequent guarded GET" needs to
 * prove.
 *
 * Credentials come from `appConfig().seedAccounts` — the same source
 * `prisma/seed.ts` reads — never hard-coded in this file.
 */

/** The api package root, resolved from this spec's own location. */
const API_PACKAGE_DIR = join(__dirname, "..", "..");

/** The initial Prisma migration that creates the four tables of the ERD. */
const INIT_MIGRATION_SQL = join(
  API_PACKAGE_DIR,
  "prisma",
  "migrations",
  "20240101000000_init",
  "migration.sql",
);

/**
 * Minimal session-guard-protected GET route standing in for
 * `GET /api/v1/kudos`.
 *
 * It exists only so the spec can prove a cookie issued by the login endpoint
 * authenticates a request on an unrelated guarded route. Its body is irrelevant
 * to the assertion; echoing the resolved member makes an unauthorized response
 * (401, no body) trivially distinguishable from an authorized one.
 */
@Controller("api/v1/kudos")
class GuardedBoardProbeController {
  @Get()
  @UseGuards(SessionGuard)
  list(@CurrentMember() member: AuthenticatedMember): unknown {
    return {
      data: [],
      session: { email: member.email, role: member.role },
    };
  }
}

/** Reads the `Set-Cookie` headers of a response as a flat string array. */
const setCookieHeaders = (response: request.Response): string[] => {
  const raw: string | string[] | undefined = response.headers["set-cookie"];
  if (raw === undefined) {
    return [];
  }
  return Array.isArray(raw) ? raw : [raw];
};

/** The `name=value` pair of a `Set-Cookie` header (attributes stripped). */
const cookiePair = (setCookieHeader: string): string =>
  setCookieHeader.split(";")[0].trim();

/**
 * Reports whether a relation exists in the `public` schema.
 *
 * `to_regclass` returns NULL for a missing table without raising, so one cheap
 * query answers "has the schema been applied?".
 */
const relationExists = async (
  prisma: PrismaService,
  table: string,
): Promise<boolean> => {
  const rows = await prisma.$queryRawUnsafe<{ oid: string | null }[]>(
    `SELECT to_regclass('public.${table}')::text AS oid`,
  );
  return rows.length > 0 && rows[0]?.oid !== null;
};

/**
 * Applies the Prisma migrations when the database is still empty.
 *
 * `prisma migrate deploy` is preferred because it also records the applied
 * migration in `_prisma_migrations`, leaving the database in exactly the state
 * a normal `pnpm --filter api exec prisma migrate deploy` produces (so no later
 * spec or task can be surprised by unrecorded DDL). Should the CLI not be
 * resolvable in the current sandbox, the statements of the checked-in initial
 * migration are executed directly as a fallback — same schema, same source of
 * truth, just without the bookkeeping row.
 */
const ensureDatabaseSchema = async (prisma: PrismaService): Promise<void> => {
  if (await relationExists(prisma, "members")) {
    return;
  }

  const deployed = spawnSync("pnpm exec prisma migrate deploy", {
    shell: true,
    cwd: API_PACKAGE_DIR,
    encoding: "utf8",
    // `DATABASE_URL` is already normalised in this process by
    // `test/setup-e2e.ts`; spawnSync inherits the environment by default.
  });

  if (deployed.status === 0 && (await relationExists(prisma, "members"))) {
    return;
  }

  // Fallback: replay the checked-in initial migration statement by statement.
  // Comment lines are dropped first — two of them contain a `;`, which would
  // otherwise split a statement in half. No string literal in this migration
  // contains a semicolon.
  const statements = readFileSync(INIT_MIGRATION_SQL, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  await prisma.$transaction(
    statements.map((statement) => prisma.$executeRawUnsafe(statement)),
  );
};

describe("Auth (POST /api/v1/auth/login + session guard)", () => {
  const config = appConfig();

  /** The seeded regular member this spec signs in as. */
  let member: SeedAccount;

  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const account =
      config.seedAccounts.find((entry) => entry.role === "MEMBER") ??
      config.seedAccounts[0];
    if (account === undefined) {
      throw new Error(
        "appConfig().seedAccounts must expose at least one account",
      );
    }
    member = account;

    const moduleRef = await Test.createTestingModule({
      // Only this feature module plus the Prisma/guard foundation — no
      // AppModule and no kudos module (e2e convention).
      imports: [AuthModule, PrismaModule],
      controllers: [GuardedBoardProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    // Same global pipe as `main.ts`, so the HTTP surface under test is
    // identical to the running application's.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = moduleRef.get(PrismaService);

    await ensureDatabaseSchema(prisma);

    // Guarantee the seeded member exists exactly as `prisma/seed.ts` writes
    // it: an idempotent upsert keyed on the unique email, storing only an
    // Argon2id hash of the app.config password (never the plaintext).
    const passwordHash = await hashPassword(member.password);
    await prisma.member.upsert({
      where: { email: member.email },
      update: { role: member.role, passwordHash },
      create: { email: member.email, role: member.role, passwordHash },
    });
  });

  afterAll(async () => {
    if (prisma !== undefined) {
      // Only rows this spec itself created — scoped to the member it signed
      // in as, so no other task's data is touched.
      await prisma.session
        .deleteMany({ where: { member: { email: member.email } } })
        .catch(() => undefined);
    }
    if (app !== undefined) {
      await app.close();
    }
  });

  it("[AC-1] valid credentials of a seeded member return 200, set the httpOnly session cookie, and that cookie authenticates a subsequent session-guard-protected GET", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: member.email, password: member.password });

    expect(login.status).toBe(200);
    expect(login.body).toEqual({
      id: expect.any(String),
      email: member.email.toLowerCase(),
      role: member.role,
    });

    // --- the httpOnly session cookie is set ---
    const cookies = setCookieHeaders(login);
    expect(cookies.length).toBeGreaterThan(0);

    // Narrow the cookie lookup to a definitely-present value; the expectations
    // below assert the attributes of *the session cookie* specifically.
    const sessionCookieHeader = cookies.find((header) =>
      header.startsWith(`${config.sessionCookieName}=`),
    );
    if (sessionCookieHeader === undefined) {
      throw new Error(
        `expected a ${config.sessionCookieName} cookie, got: ${cookies.join(" | ")}`,
      );
    }

    const attributes = sessionCookieHeader.toLowerCase();
    expect(attributes).toContain("httponly");
    expect(attributes).toContain("samesite=lax");

    const header = cookiePair(sessionCookieHeader);
    const cookieValue = header.split("=").slice(1).join("=");
    expect(cookieValue.length).toBeGreaterThan(0);

    // --- that cookie authenticates a session-guard-protected GET ---
    const guardedBoard = await request(app.getHttpServer())
      .get("/api/v1/kudos")
      .set("Cookie", header);
    expect(guardedBoard.status).toBe(200);

    // The same guarded route without the cookie is 401: the 200 above is
    // attributable to the cookie, not to an unguarded route.
    const anonymousBoard = await request(app.getHttpServer()).get(
      "/api/v1/kudos",
    );
    expect(anonymousBoard.status).toBe(401);

    // The cookie also resolves GET /api/v1/auth/session to the member.
    const session = await request(app.getHttpServer())
      .get("/api/v1/auth/session")
      .set("Cookie", header);
    expect(session.status).toBe(200);
    expect(session.body).toEqual({
      email: member.email.toLowerCase(),
      role: member.role,
    });
  });

  it("[AC-2] a valid email with a wrong password returns 401 and sets no session cookie", async () => {
    const sessionsBefore = await prisma.session.count({
      where: { member: { email: member.email } },
    });

    const wrongPassword = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: member.email, password: `${member.password}!wrong` });

    expect(wrongPassword.status).toBe(401);

    // No Set-Cookie header of any kind is produced.
    expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
    expect(setCookieHeaders(wrongPassword)).toHaveLength(0);

    // No session row was persisted either.
    const sessionsAfter = await prisma.session.count({
      where: { member: { email: member.email } },
    });
    expect(sessionsAfter).toBe(sessionsBefore);

    // The message is generic: it must not echo the submitted identifier...
    const message = wrongPassword.body?.message;
    expect(typeof message).toBe("string");
    expect(String(message).toLowerCase()).not.toContain(
      member.email.toLowerCase(),
    );

    // ...and it must be identical to the unknown-email response, so the
    // endpoint cannot be used to enumerate which emails have an account.
    const unknownEmail = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "nobody@kudos.local", password: member.password });

    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.headers["set-cookie"]).toBeUndefined();
    expect(setCookieHeaders(unknownEmail)).toHaveLength(0);
    expect(unknownEmail.body?.message).toBe(message);
  });
});
