import {
  Controller,
  Get,
  HttpStatus,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execFileSync } from "node:child_process";
import type { INestApplication } from "@nestjs/common";
import type { Server as HttpServer } from "node:http";
import * as path from "node:path";
import request from "supertest";
import { loadAppConfig, type AppConfig } from "../app.config";
import { CurrentMember } from "../common/decorators/current-member.decorator";
import {
  AuthenticatedMember,
  SessionGuard,
} from "../common/guards/session.guard";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { seedMembers } from "../../prisma/seed";
import { AuthModule } from "./auth.module";

/**
 * Auth e2e spec (T-5 / EP-1 / EP-2 / ADR-1 / ADR-2).
 *
 * Runs against the real PostgreSQL service of the root `docker-compose.yml` -
 * `test/setup-e2e.ts` applies the `DATABASE_URL` default before this module is
 * imported - and exercises the real stack: `PrismaService`, the T-2 schema, the
 * Argon2id hashes written by the T-4 seed script and the T-3 `verifyPassword`
 * funnel. Seeded credentials are taken from `app.config`, never hardcoded here.
 *
 * Mounting convention (per the task): only `AuthModule` plus the Prisma/guard
 * foundation modules are imported. `GET /api/v1/kudos` belongs to a later task,
 * so this spec mounts a **minimal route at that exact path, guarded exactly the
 * way the real one will be** - it proves the cookie issued by EP-1 is the
 * credential `SessionGuard` accepts, which is what AC-1 asks of that endpoint.
 */

/** `apps/api`, the package the Prisma CLI has to run in. */
const APP_ROOT = path.resolve(__dirname, "..", "..");

/** Credentials of the seeded MEMBER account, via app.config. */
const CONFIG: AppConfig = loadAppConfig();

/** A deliberately wrong password for the negative cases (AC-2). */
const WRONG_PASSWORD = "not-the-seeded-password-at-all";

/** The only roles a member can hold (mirrors the `MemberRole` Prisma enum). */
const MEMBER_ROLES = ["MEMBER", "LEAD"] as const;

/**
 * Minimal stand-in for the kudos list route: session-guarded, and reporting the
 * member the guard resolved so the spec can assert *who* got authenticated.
 */
@Controller("api/v1/kudos")
class GuardedKudosProbeController {
  @Get()
  @UseGuards(SessionGuard)
  list(@CurrentMember() member: AuthenticatedMember) {
    return {
      items: [] as unknown[],
      viewer: { id: member.id, email: member.email, role: member.role },
    };
  }
}

/**
 * Applies the checked-in Prisma migrations when the schema is not there yet.
 *
 * The migration belongs to T-2 and the seed to T-4; running them here makes this
 * spec self-sufficient against a freshly created `postgres-data` volume.
 * `migrate deploy` is a no-op once the migration is recorded, so it is safe on
 * an already-migrated database (and in CI, which migrates before testing).
 */
function ensureSchema(): void {
  const prismaCli = path.join(
    APP_ROOT,
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: APP_ROOT,
    stdio: "ignore",
  });
}

describe("auth e2e (POST /api/v1/auth/login, GET /api/v1/auth/session)", () => {
  let app: INestApplication;
  let server: HttpServer;
  let prisma: PrismaService;

  beforeAll(async () => {
    ensureSchema();

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, PrismaModule],
      controllers: [GuardedKudosProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    // The same pipe `main.ts` registers globally, so a malformed body is a 400
    // here exactly as in production - never a silent drop, never a 500.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
      }),
    );
    await app.init();

    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    // Converge the seeded roster (T-4). Upserts keyed on email, so this is
    // idempotent and makes the spec independent of who ran it before.
    await seedMembers(prisma);
  });

  afterAll(async () => {
    // Drop only the sessions this spec opened; the seeded members stay put.
    await prisma?.session.deleteMany({ where: {} }).catch(() => undefined);
    await app?.close();
  });

  it("[AC-1] returns 200 with the httpOnly session cookie and that cookie authenticates a session-guard-protected GET", async () => {
    const login = await request(server)
      .post("/api/v1/auth/login")
      .send({
        email: CONFIG.seedMember.email,
        password: CONFIG.seedMember.password,
      });

    expect(login.status).toBe(HttpStatus.OK);

    // The body is the signed-in member - and never any secret material.
    const seeded = await prisma.member.findFirst({
      where: { email: { equals: CONFIG.seedMember.email, mode: "insensitive" } },
      select: { id: true, email: true, role: true },
    });
    expect(seeded).not.toBeNull();
    // The roster role is whatever the T-4 seed wrote - always MEMBER or LEAD.
    expect(MEMBER_ROLES).toContain(seeded?.role);
    expect(login.body).toEqual({
      id: seeded?.id,
      email: seeded?.email,
      role: seeded?.role,
    });
    expect(JSON.stringify(login.body)).not.toMatch(/password/i);

    // The cookie: name from app.config, httpOnly, SameSite=Lax.
    const setCookie = login.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookieLine = String(
      Array.isArray(setCookie) ? setCookie[0] : setCookie,
    );
    const [cookieName, sessionId] = cookieLine.split(";")[0].split("=");
    expect(cookieName).toBe(CONFIG.sessionCookieName);
    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(20);
    expect(cookieLine.toLowerCase()).toContain("httponly");
    expect(cookieLine.toLowerCase()).toContain("samesite=lax");

    // The cookie value is a real server-side Session row expiring at now+TTL.
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });
    expect(session).not.toBeNull();
    expect(session?.memberId).toBe(seeded?.id);
    const remainingMs = (session?.expiresAt.getTime() ?? 0) - Date.now();
    expect(remainingMs).toBeGreaterThan(0);
    expect(remainingMs).toBeLessThanOrEqual(CONFIG.sessionTtlSeconds * 1000);

    // Control: the guarded route refuses an anonymous caller with 401...
    const anonymous = await request(server).get("/api/v1/kudos");
    expect(anonymous.status).toBe(HttpStatus.UNAUTHORIZED);

    // ...and admits the caller holding exactly the cookie EP-1 issued.
    const guarded = await request(server)
      .get("/api/v1/kudos")
      .set("Cookie", `${cookieName}=${sessionId}`);
    expect(guarded.status).toBe(HttpStatus.OK);
    expect(guarded.body.viewer).toEqual({
      id: seeded?.id,
      email: seeded?.email,
      role: seeded?.role,
    });

    // EP-2: the same cookie answers GET /api/v1/auth/session with the member.
    const whoAmI = await request(server)
      .get("/api/v1/auth/session")
      .set("Cookie", `${cookieName}=${sessionId}`);
    expect(whoAmI.status).toBe(HttpStatus.OK);
    expect(whoAmI.body).toEqual({ email: seeded?.email, role: seeded?.role });

    // EP-2 without a cookie is 401 (missing session)...
    const noCookie = await request(server).get("/api/v1/auth/session");
    expect(noCookie.status).toBe(HttpStatus.UNAUTHORIZED);

    // ...and so is a cookie nobody issued (unknown session).
    const unknownCookie = await request(server)
      .get("/api/v1/auth/session")
      .set("Cookie", `${CONFIG.sessionCookieName}=no-such-session-id`);
    expect(unknownCookie.status).toBe(HttpStatus.UNAUTHORIZED);
  });

  it("[AC-2] returns 401 and sets no session cookie for a valid email with a wrong password", async () => {
    const sessionsBefore = await prisma.session.count({ where: {} });

    const wrongPassword = await request(server)
      .post("/api/v1/auth/login")
      .send({ email: CONFIG.seedMember.email, password: WRONG_PASSWORD });

    expect(wrongPassword.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(wrongPassword.headers["set-cookie"]).toBeUndefined();

    // Generic failure message - nothing that lets a caller enumerate accounts.
    expect(typeof wrongPassword.body.message).toBe("string");
    expect(wrongPassword.body.message).not.toContain(
      CONFIG.seedMember.email.split("@")[0],
    );

    // An unknown email answers with the very same generic 401.
    const unknownEmail = await request(server)
      .post("/api/v1/auth/login")
      .send({ email: "nobody-here@kudos.local", password: WRONG_PASSWORD });
    expect(unknownEmail.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(unknownEmail.headers["set-cookie"]).toBeUndefined();
    expect(unknownEmail.body.message).toBe(wrongPassword.body.message);

    // Neither attempt persisted a session.
    expect(await prisma.session.count({ where: {} })).toBe(sessionsBefore);
  });

  it("rejects a malformed login body with 400 via the validation pipe", async () => {
    const malformed = await request(server)
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: "" });

    expect(malformed.status).toBe(HttpStatus.BAD_REQUEST);
    expect(malformed.headers["set-cookie"]).toBeUndefined();
    expect(malformed.body.message).toBeDefined();
  });
});
