import "reflect-metadata";

import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import {
  APP_CONFIG,
  appConfig,
  DEFAULT_SESSION_COOKIE_NAME,
  KUDOS_MESSAGE_MAX_LENGTH,
  KUDOS_PAGE_SIZE,
} from "@/app.config";
import { RolesGuard } from "@/common/guards/roles.guard";
import { SessionGuard } from "@/common/guards/session.guard";
import { PrismaModule } from "@/prisma/prisma.module";
import { PrismaService } from "@/prisma/prisma.service";

import { KudosModule } from "./kudos.module";
import { ensureSchema } from "../../test/ensure-schema";

/**
 * E2E spec for the kudos module (EP-3 `GET /api/v1/kudos`, EP-4
 * `POST /api/v1/kudos`) against the docker-compose PostgreSQL.
 *
 * The auth module is deliberately not imported: `SessionGuard` resolves the
 * session straight from the `sessions` table, so this suite authenticates by
 * inserting a `Session` row per member and sending that id as the httpOnly
 * session cookie — no login round-trip, no cross-task dependency.
 *
 * A `Test.createNestApplication()` does not inherit `src/main.ts`'s wiring, so
 * the one piece that changes the answers under test is reproduced here: the
 * `ValidationPipe` whose `exceptionFactory` maps an invalid body to a 400
 * `BadRequestException` (AC-8 / AC-9). The `/api/v1` prefix lives on the
 * controller itself.
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
    upsert(args: {
      where: { email: string };
      update: { role: MemberRoleValue };
      create: {
        email: string;
        role: MemberRoleValue;
        passwordHash: string;
      };
    }): Promise<{ id: string; email: string; role: MemberRoleValue }>;
    deleteMany(args: {
      where: { email: { in: readonly string[] } };
    }): Promise<number>;
  };
  readonly kudos: {
    create(args: {
      data: {
        authorId: string;
        recipientId: string;
        message: string;
        createdAt?: Date;
        hiddenAt?: Date | null;
      };
    }): Promise<{ id: string }>;
    deleteMany(args?: { where?: unknown }): Promise<number>;
    count(args?: { where?: unknown }): Promise<number>;
  };
  readonly session: {
    create(args: {
      data: { id: string; memberId: string; expiresAt: Date };
    }): Promise<{ id: string }>;
    deleteMany(args?: { where?: unknown }): Promise<number>;
  };
}

/**
 * Occupies the required `passwordHash` column without being a credential: no
 * spec here signs in, so nothing ever needs a real hash and no plaintext secret
 * is written anywhere.
 */
const PLACEHOLDER_HASH = "argon2id$e2e$fixture$not-a-credential";

/** Members this spec owns; `afterAll` removes them and, by cascade, their data. */
const MEMBER_EMAIL = "t6-member@kudos.test";
const OTHER_MEMBER_EMAIL = "t6-colleague@kudos.test";
const LEAD_EMAIL = "t6-lead@kudos.test";
const FIXTURE_EMAILS: readonly string[] = [
  MEMBER_EMAIL,
  OTHER_MEMBER_EMAIL,
  LEAD_EMAIL,
];

/** Opaque session ids, unique to this spec. */
const MEMBER_SESSION_ID = "t6-member-session-id";
const LEAD_SESSION_ID = "t6-lead-session-id";

/** The endpoint under test. */
const KUDOS_PATH = "/api/v1/kudos";

/** One kudos as the API returns it (ADR-7). */
interface KudosPayload {
  id: string;
  recipient: string;
  message: string;
  author: { id: string; email: string };
  createdAt: string;
  reactions: { emoji: string; count: number; mine: boolean }[];
  hiddenAt?: string | null;
  hiddenBy?: string | null;
}

/** One entry of the `message` array a validation 400 carries. */
interface ValidationFailure {
  readonly property: string;
  readonly constraints?: Record<string, string>;
}

/**
 * Descending string comparison, matching the `id desc` Prisma/Postgres ordering
 * used as the stable tiebreak of ADR-6 (ids are lowercase cuids, so codepoint
 * order and the database collation agree).
 */
const byIdDesc = (left: string, right: string): number =>
  left < right ? 1 : left > right ? -1 : 0;

describe("Kudos module (EP-3 / EP-4) e2e", () => {
  let app: INestApplication;
  let prisma: TestPrismaClient;
  let memberId: string;
  let colleagueId: string;
  let leadId: string;

  /** `Cookie` header authenticating as the regular member. */
  const memberCookie = (): string =>
    `${DEFAULT_SESSION_COOKIE_NAME}=${MEMBER_SESSION_ID}`;

  /** `Cookie` header authenticating as the team lead. */
  const leadCookie = (): string =>
    `${DEFAULT_SESSION_COOKIE_NAME}=${LEAD_SESSION_ID}`;

  /** Reads a JSON array body, asserting it really is an array. */
  const listOf = (body: unknown): KudosPayload[] => {
    expect(Array.isArray(body)).toBe(true);
    return (body as KudosPayload[]).slice();
  };

  /** Reads the `message` array of a validation 400, asserting its shape. */
  const failuresOf = (body: unknown): ValidationFailure[] => {
    expect(Array.isArray((body as { message?: unknown }).message)).toBe(true);
    return (body as { message: ValidationFailure[] }).message;
  };

  /**
   * Removes only this spec's kudos rows.
   *
   * Every row this spec creates involves one of its three fixture members, so
   * scoping the delete to them keeps a shared dev database's other data intact
   * while still giving each test an empty board of its own.
   */
  const cleanKudos = async (): Promise<void> => {
    await prisma.kudos.deleteMany({
      where: {
        OR: [
          { authorId: { in: [memberId, colleagueId, leadId] } },
          { recipientId: { in: [memberId, colleagueId, leadId] } },
        ],
      },
    });
  };

  /** Inserts a kudos row directly, bypassing the endpoint. */
  const seedKudos = async (
    authorId: string,
    recipientId: string,
    message: string,
    createdAt: Date,
    hiddenAt: Date | null = null,
  ): Promise<string> => {
    const created = await prisma.kudos.create({
      data: { authorId, recipientId, message, createdAt, hiddenAt },
    });
    return created.id;
  };

  /** `POST /api/v1/kudos` as the regular member. */
  const postKudos = (
    body: Record<string, unknown>,
    cookie: string | null = memberCookie(),
  ) => {
    const req = request(app.getHttpServer()).post(KUDOS_PATH).send(body);
    return cookie === null ? req : req.set("Cookie", cookie);
  };

  /** `GET /api/v1/kudos` as the regular member. */
  const getKudos = (query: string = "") =>
    request(app.getHttpServer())
      .get(`${KUDOS_PATH}${query}`)
      .set("Cookie", memberCookie());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // KudosModule brings its controller/service; PrismaModule is the
      // persistence foundation and the two guards the auth foundation.
      imports: [KudosModule, PrismaModule],
      providers: [
        SessionGuard,
        RolesGuard,
        { provide: APP_CONFIG, useFactory: appConfig },
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    // Mirrors `src/main.ts`: a validation failure becomes a 400 carrying
    // `[{ property, constraints }]` — never a silent drop and never a 500.
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

    // Nothing in the workspace applies `prisma/migrations`, so make sure the
    // schema exists before touching any table. A no-op when already migrated.
    await ensureSchema(app.get(PrismaService));

    // The roster this spec depends on.
    await prisma.session.deleteMany({
      where: { id: { in: [MEMBER_SESSION_ID, LEAD_SESSION_ID] } },
    });

    const upsert = (email: string, role: MemberRoleValue) =>
      prisma.member.upsert({
        where: { email },
        update: { role },
        create: { email, role, passwordHash: PLACEHOLDER_HASH },
      });

    const member = await upsert(MEMBER_EMAIL, "MEMBER");
    const colleague = await upsert(OTHER_MEMBER_EMAIL, "MEMBER");
    const lead = await upsert(LEAD_EMAIL, "LEAD");

    memberId = member.id;
    colleagueId = colleague.id;
    leadId = lead.id;

    // Sessions are inserted directly: the auth module is not under test here.
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.create({
      data: { id: MEMBER_SESSION_ID, memberId, expiresAt },
    });
    await prisma.session.create({
      data: { id: LEAD_SESSION_ID, memberId: leadId, expiresAt },
    });

    await cleanKudos();
  });

  beforeEach(async () => {
    // Every AC starts from a known board — the "exactly 20" claims of AC-11
    // only mean anything if no earlier test's rows are still on it.
    await cleanKudos();
  });

  afterAll(async () => {
    // Deleting the fixture members cascades away their kudos and sessions.
    await prisma.member.deleteMany({ where: { email: { in: FIXTURE_EMAILS } } });
    await app.close();
  });

  it("[AC-3] GET and POST /api/v1/kudos without a session cookie each return 401", async () => {
    const listResponse = await request(app.getHttpServer())
      .get(KUDOS_PATH)
      .expect(401);

    expect(listResponse.body.statusCode).toBe(401);

    const postResponse = await request(app.getHttpServer())
      .post(KUDOS_PATH)
      .send({ recipient: OTHER_MEMBER_EMAIL, message: "never persisted" })
      .expect(401);

    expect(postResponse.body.statusCode).toBe(401);

    // The guard rejected the write before any handler ran, so nothing landed.
    expect(
      await prisma.kudos.count({ where: { message: "never persisted" } }),
    ).toBe(0);
  });

  it("[AC-6] POST with a recipient and a message returns 201 with the created kudos", async () => {
    const response = await postKudos({
      recipient: OTHER_MEMBER_EMAIL,
      message: "Great pairing session today!",
    }).expect(201);

    const body = response.body as KudosPayload;

    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.recipient).toBe(OTHER_MEMBER_EMAIL);
    expect(body.message).toBe("Great pairing session today!");
    // The posting session member is the author — never a body-supplied one.
    expect(body.author).toEqual({ id: memberId, email: MEMBER_EMAIL });
    expect(Number.isNaN(new Date(body.createdAt).getTime())).toBe(false);
    // Reactions are computed at read time; empty until that module lands.
    expect(body.reactions).toEqual([]);

    // The row really was persisted with the session member as its author.
    expect(await prisma.kudos.count({ where: { id: body.id } })).toBe(1);
    expect(
      await prisma.kudos.count({
        where: { id: body.id, authorId: memberId, recipientId: colleagueId },
      }),
    ).toBe(1);
  });

  it("[AC-8] a 280-char message returns 201 while a 281-char message returns 400 and persists nothing", async () => {
    const valid = "y".repeat(KUDOS_MESSAGE_MAX_LENGTH);

    const created = await postKudos({
      recipient: OTHER_MEMBER_EMAIL,
      message: valid,
    }).expect(201);

    expect((created.body.message as string).length).toBe(
      KUDOS_MESSAGE_MAX_LENGTH,
    );
    expect(await prisma.kudos.count({ where: { message: valid } })).toBe(1);

    const invalid = "y".repeat(KUDOS_MESSAGE_MAX_LENGTH + 1);

    const rejected = await postKudos({
      recipient: OTHER_MEMBER_EMAIL,
      message: invalid,
    }).expect(400);

    // The 400 names the offending field rather than failing silently.
    const messageFailure = failuresOf(rejected.body).find(
      (failure) => failure.property === "message",
    );
    expect(messageFailure).toBeDefined();
    expect(Object.keys(messageFailure?.constraints ?? {})).toEqual(
      expect.arrayContaining([expect.stringMatching(/length/i)]),
    );

    expect(await prisma.kudos.count({ where: { message: invalid } })).toBe(0);
  });

  it("[AC-9] a missing recipient or an empty message returns 400 and creates no kudos", async () => {
    const missingRecipient = await postKudos({
      message: "thanks for the review",
    }).expect(400);

    expect(
      failuresOf(missingRecipient.body).some(
        (failure) => failure.property === "recipient",
      ),
    ).toBe(true);

    const emptyMessage = await postKudos({
      recipient: OTHER_MEMBER_EMAIL,
      message: "",
    }).expect(400);

    expect(
      failuresOf(emptyMessage.body).some(
        (failure) => failure.property === "message",
      ),
    ).toBe(true);

    // Neither rejected body produced a row for this spec's members.
    expect(await prisma.kudos.count({ where: { authorId: memberId } })).toBe(0);
    expect(await prisma.kudos.count({ where: { authorId: leadId } })).toBe(0);
  });

  it("[AC-10] after kudos A is posted and then kudos B, GET lists B before A", async () => {
    const a = await postKudos({ recipient: OTHER_MEMBER_EMAIL, message: "A" })
      .expect(201);
    const b = await postKudos({ recipient: OTHER_MEMBER_EMAIL, message: "B" })
      .expect(201);

    // ADR-6's stable tiebreak, checked separately: two rows sharing one
    // timestamp (a minute older than A and B) order on `id desc`.
    const shared = new Date(Date.now() - 60_000);
    const tieIds = [
      await seedKudos(memberId, colleagueId, "tiebreak first", shared),
      await seedKudos(memberId, colleagueId, "tiebreak second", shared),
    ];
    const tieExpected = [...tieIds].sort(byIdDesc);

    const list = listOf((await getKudos().expect(200)).body);

    // Newest first: B (posted last) precedes A, and both — being newer than the
    // seeded pair — precede it; that pair then breaks its tie on `id desc`.
    expect(list.map((kudos) => kudos.id)).toEqual([
      b.body.id,
      a.body.id,
      ...tieExpected,
    ]);
    expect(
      list.findIndex((kudos) => kudos.id === b.body.id),
    ).toBeLessThan(list.findIndex((kudos) => kudos.id === a.body.id));
  });

  it("[AC-11] with 25 visible kudos page 1 returns the 20 newest and page 2 the remaining 5", async () => {
    // 26 rows a minute apart, oldest first; the newest one is soft-hidden so
    // the exclusion is actually observable, leaving exactly 25 visible.
    const base = Date.now() - 26 * 60_000;
    const seeded: { id: string; message: string; hidden: boolean }[] = [];

    for (let index = 0; index < 26; index += 1) {
      const hidden = index === 25;
      const message = `AC-11 kudos #${index}`;
      const id = await seedKudos(
        memberId,
        colleagueId,
        message,
        new Date(base + index * 60_000),
        hidden ? new Date() : null,
      );
      seeded.push({ id, message, hidden });
    }

    // The visible ids, newest first — computed independently of the endpoint.
    const expectedVisible = seeded
      .filter((row) => !row.hidden)
      .reverse()
      .map((row) => row.id);
    expect(expectedVisible).toHaveLength(25);

    const page1 = listOf((await getKudos("?page=1").expect(200)).body);
    const page2 = listOf((await getKudos("?page=2").expect(200)).body);

    expect(page1).toHaveLength(KUDOS_PAGE_SIZE);
    expect(page2).toHaveLength(5);

    // Across both pages: no duplicates, no omissions, newest-first order.
    const allPages = [...page1, ...page2];
    expect(allPages.map((kudos) => kudos.id)).toEqual(expectedVisible);
    expect(new Set(allPages.map((kudos) => kudos.id)).size).toBe(25);

    // The soft-hidden kudos is absent for this member and every other one.
    expect(
      allPages.some((kudos) => kudos.message === "AC-11 kudos #25"),
    ).toBe(false);

    // Every item arrives in the uniform ADR-7 shape the board renders.
    for (const kudos of allPages) {
      expect(kudos.recipient).toBe(OTHER_MEMBER_EMAIL);
      expect(kudos.author).toEqual({ id: memberId, email: MEMBER_EMAIL });
      expect(Number.isNaN(new Date(kudos.createdAt).getTime())).toBe(false);
      expect(Array.isArray(kudos.reactions)).toBe(true);
      expect(kudos.hiddenAt).toBeUndefined();
    }

    // The review variant of the same endpoint is lead-only: a MEMBER session
    // is refused with 403 rather than shown an empty hidden list.
    const review = await request(app.getHttpServer())
      .get(`${KUDOS_PATH}?hidden=true`)
      .set("Cookie", memberCookie())
      .expect(403);
    expect(review.body.statusCode).toBe(403);

    // A lead session sees that hidden row, in the standard shape plus the
    // soft-hide bookkeeping.
    const leadReview = listOf(
      (
        await request(app.getHttpServer())
          .get(`${KUDOS_PATH}?hidden=true`)
          .set("Cookie", leadCookie())
          .expect(200)
      ).body,
    );
    expect(leadReview.map((kudos) => kudos.message)).toEqual([
      "AC-11 kudos #25",
    ]);
    expect(leadReview[0].id).toBe(seeded[25].id);
    expect(leadReview[0].hiddenAt).not.toBeNull();
    expect(leadReview[0].reactions).toEqual([]);
  });
});
