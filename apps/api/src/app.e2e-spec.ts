import "reflect-metadata";

import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
// Metadata keys `@Module()` writes; reading them back is what Nest itself does
// when it builds the dependency graph, so they are stable across Nest 10.
import { MODULE_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { DEFAULT_SESSION_COOKIE_NAME } from "@/app.config";
import { AppModule } from "@/app.module";
import { AuthService } from "@/auth/auth.service";
import { AuthModule } from "@/auth/auth.module";
import { HealthController } from "@/health/health.controller";
import { KudosModule } from "@/kudos/kudos.module";
import { KudosService } from "@/kudos/kudos.service";
import { ModerationModule } from "@/moderation/moderation.module";
import { ModerationService } from "@/moderation/moderation.service";
import { PrismaModule } from "@/prisma/prisma.module";
import { PrismaService } from "@/prisma/prisma.service";
import { ReactionsModule } from "@/reactions/reactions.module";
import { ReactionsService } from "@/reactions/reactions.service";
// One level up from the feature suites: this spec lives in `src/`, not
// `src/<feature>/`, so `../test` — not `../../test` — reaches `apps/api/test`.
import { ensureSchema } from "../test/ensure-schema";

/**
 * Full-wiring e2e for `AppModule` (T-9).
 *
 * Every feature suite (auth, kudos, reactions, moderation) boots its *own*
 * testing module. This spec is the one place that boots the real root module —
 * `imports: [AppModule]` and nothing else — and asserts the composition itself:
 *
 * * all four feature modules plus `PrismaModule` are registered on it;
 * * the resulting application answers on every feature's route;
 * * composition did not weaken auth: every kudos, reaction and moderation
 *   route still returns **401** without a session cookie (ADR-1), while
 *   `GET /health` and `POST /api/v1/auth/login` stay reachable without one;
 * * the global `ValidationPipe` still maps a bad body to **400** on the booted
 *   app (mirroring `src/main.ts`, which `createNestApplication` does not
 *   inherit).
 *
 * Sessions are inserted directly (the pattern the feature suites use) so this
 * spec asserts *wiring*, not credential handling, which `auth.e2e-spec.ts`
 * already owns.
 */

/** `MemberRole` values of `prisma/schema.prisma`, spelled out locally. */
type MemberRoleValue = "MEMBER" | "LEAD";

/**
 * The slice of the generated `PrismaClient` this spec needs, declared
 * structurally so it type-checks before `prisma generate` has produced the
 * client — the same approach as `src/prisma/prisma.service.ts`.
 */
interface TestPrismaClient {
  readonly member: {
    create(args: {
      data: { email: string; role: MemberRoleValue; passwordHash: string };
    }): Promise<{ id: string; email: string; role: MemberRoleValue }>;
    deleteMany(args: {
      where: { email: { in: readonly string[] } };
    }): Promise<number>;
  };
  readonly kudos: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args?: { where?: unknown }): Promise<number>;
  };
  readonly session: {
    create(args: {
      data: { id: string; memberId: string; expiresAt: Date };
    }): Promise<{ id: string }>;
    deleteMany(args?: { where?: unknown }): Promise<number>;
  };
}

/**
 * Occupies the required `passwordHash` column without being a credential: this
 * spec never signs in, so nothing needs a real hash and no plaintext secret is
 * written anywhere.
 */
const PLACEHOLDER_HASH = "argon2id$e2e$fixture$not-a-credential";

/** Member this spec owns; `afterAll` removes it and, by cascade, its data. */
const MEMBER_EMAIL = "t9-member@kudos.test";
const FIXTURE_EMAILS: readonly string[] = [MEMBER_EMAIL];

/** Opaque session id, unique to this spec. */
const MEMBER_SESSION_ID = "t9-member-session-id";

const AUTH_LOGIN_PATH = "/api/v1/auth/login";
const AUTH_SESSION_PATH = "/api/v1/auth/session";
const KUDOS_PATH = "/api/v1/kudos";
const REACTIONS_PATH = "/api/v1/kudos/some-kudos-id/reactions";
const HIDE_PATH = "/api/v1/kudos/some-kudos-id/hide";
const HEALTH_PATH = "/health";

/** Reads a nested `body.message` array, asserting it really is an array. */
const messagesOf = (body: unknown): unknown[] => {
  const message = (body as { message?: unknown }).message;
  expect(Array.isArray(message)).toBe(true);
  return message as unknown[];
};

describe("AppModule full wiring (T-9)", () => {
  let app: INestApplication;
  let prisma: TestPrismaClient;

  /** `Cookie` header authenticating as the fixture member. */
  const memberCookie = (): string =>
    `${DEFAULT_SESSION_COOKIE_NAME}=${MEMBER_SESSION_ID}`;

  beforeAll(async () => {
    // The whole point of this spec: the real root module and nothing else.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();

    // Mirrors `src/main.ts` exactly. A testing application does not inherit
    // `main.ts` wiring, and the 400-on-a-bad-body behaviour is part of what
    // this task composes, so it is reproduced here rather than assumed.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
        exceptionFactory: (errors) =>
          new BadRequestException(
            errors.map((error) => ({
              property: error.property,
              constraints: error.constraints,
            })),
          ),
      }),
    );

    await app.init();

    prisma = app.get(PrismaService) as unknown as TestPrismaClient;

    // Nothing in the workspace applies `prisma/migrations`; this is a no-op
    // when the schema already exists because an earlier suite booted first.
    await ensureSchema(app.get(PrismaService));

    // Remove a leftover fixture from an aborted run first — deleting the member
    // cascades away its kudos and sessions, so the create below cannot collide.
    await prisma.member.deleteMany({ where: { email: { in: FIXTURE_EMAILS } } });

    const member = await prisma.member.create({
      data: {
        email: MEMBER_EMAIL,
        role: "MEMBER",
        passwordHash: PLACEHOLDER_HASH,
      },
    });

    await prisma.session.deleteMany({
      where: { id: MEMBER_SESSION_ID },
    });
    await prisma.session.create({
      data: {
        id: MEMBER_SESSION_ID,
        memberId: member.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    // Deleting the fixture member cascades away its sessions and kudos.
    // Guarded: a failed `beforeAll` must not turn into a second, noisier error
    // here ("Cannot read properties of undefined") on top of the real one.
    if (prisma !== undefined) {
      await prisma.member.deleteMany({
        where: { email: { in: FIXTURE_EMAILS } },
      });
    }
    await app.close();
  });

  it("registers PrismaModule, AuthModule, KudosModule, ReactionsModule and ModerationModule", () => {
    // Declared composition: what `@Module()` recorded, read back the same way
    // the framework reads it when it builds the dependency graph.
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    ) as unknown[];
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      AppModule,
    ) as unknown[];

    expect(imports).toEqual(
      expect.arrayContaining([
        PrismaModule,
        AuthModule,
        KudosModule,
        ReactionsModule,
        ModerationModule,
      ]),
    );
    expect(imports).toHaveLength(5);

    // The health route is registered on the root module, not smuggled into a
    // feature module's controller list.
    expect(controllers).toEqual(expect.arrayContaining([HealthController]));

    // The composed injector really resolves each feature's service, i.e. the
    // modules were wired, not merely listed.
    expect(app.get(AuthService, { strict: false })).toBeDefined();
    expect(app.get(KudosService, { strict: false })).toBeDefined();
    expect(app.get(ReactionsService, { strict: false })).toBeDefined();
    expect(app.get(ModerationService, { strict: false })).toBeDefined();
    expect(app.get(PrismaService, { strict: false })).toBeDefined();
  });

  it("boots as one Nest application and answers on every feature's route", async () => {
    const server = app.getHttpServer();

    // Kudos module: a Prisma-backed board read behind a real session.
    const board = await request(server)
      .get(KUDOS_PATH)
      .set("Cookie", memberCookie())
      .expect(200);
    expect(Array.isArray(board.body)).toBe(true);

    // Auth module: the public login route is mounted and answered by the
    // service (unknown member → the single generic 401, no cookie set).
    const login = await request(server)
      .post(AUTH_LOGIN_PATH)
      .send({ email: "not-a-member@kudos.test", password: "irrelevant" })
      .expect(401);
    expect(login.headers["set-cookie"]).toBeUndefined();

    // Reactions module: route mounted, session guard answered it.
    await request(server)
      .put(REACTIONS_PATH)
      .send({ emoji: "👍" })
      .expect(401);

    // Moderation module: route mounted, session guard answered it.
    await request(server).post(HIDE_PATH).expect(401);
  });

  it("exposes GET /health publicly: an unauthenticated request returns 200 with {\"status\":\"ok\"}", async () => {
    // No Cookie header at all — exactly what a deployment liveness probe sends.
    const response = await request(app.getHttpServer())
      .get(HEALTH_PATH)
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("keeps POST /api/v1/auth/login public while GET /api/v1/auth/session stays guarded", async () => {
    const server = app.getHttpServer();

    // The login route is reachable with no cookie and is validated by the
    // global pipe — a 400 here proves the request passed no guard and reached
    // the ValidationPipe, whereas a guard would have answered 401 first.
    const malformedLogin = await request(server)
      .post(AUTH_LOGIN_PATH)
      .send({ email: "not-an-email" })
      .expect(400);
    expect(messagesOf(malformedLogin.body).length).toBeGreaterThan(0);

    // The session-reading route is the guarded counterpart: no cookie → 401.
    const session = await request(server).get(AUTH_SESSION_PATH).expect(401);
    expect(session.body.statusCode).toBe(401);
  });

  it("preserves the session guard on every kudos, reaction and moderation route (401 without a cookie)", async () => {
    const server = app.getHttpServer();

    // GET /api/v1/kudos
    const list = await request(server).get(KUDOS_PATH).expect(401);
    expect(list.body.statusCode).toBe(401);

    // POST /api/v1/kudos
    const create = await request(server)
      .post(KUDOS_PATH)
      .send({ recipient: MEMBER_EMAIL, message: "never persisted" })
      .expect(401);
    expect(create.body.statusCode).toBe(401);

    // PUT /api/v1/kudos/:id/reactions
    const react = await request(server)
      .put(REACTIONS_PATH)
      .send({ emoji: "👍" })
      .expect(401);
    expect(react.body.statusCode).toBe(401);

    // POST /api/v1/kudos/:id/hide
    const hide = await request(server).post(HIDE_PATH).expect(401);
    expect(hide.body.statusCode).toBe(401);

    // The guarded write was refused before any handler ran, so nothing is
    // persisted — the guard is real, not just a status code.
    expect(
      await prisma.kudos.count({ where: { message: "never persisted" } }),
    ).toBe(0);
  });

  it("keeps the global ValidationPipe answering 400 on the booted application", async () => {
    const response = await request(app.getHttpServer())
      .post(KUDOS_PATH)
      .set("Cookie", memberCookie())
      .send({ recipient: MEMBER_EMAIL, message: "" })
      .expect(400);

    // The 400 names the offending field rather than failing silently.
    expect(
      messagesOf(response.body).some(
        (failure) => (failure as { property?: string }).property === "message",
      ),
    ).toBe(true);

    expect(await prisma.kudos.count({ where: { message: "" } })).toBe(0);
  });
});
