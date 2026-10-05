import "reflect-metadata";

import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import {
  APP_CONFIG,
  appConfig,
  DEFAULT_SESSION_COOKIE_NAME,
} from "@/app.config";
import { RolesGuard } from "@/common/guards/roles.guard";
import { SessionGuard } from "@/common/guards/session.guard";
import { hashPassword } from "@/common/security/password.util";
import { KudosModule } from "@/kudos/kudos.module";
import { PrismaModule } from "@/prisma/prisma.module";
import { PrismaService } from "@/prisma/prisma.service";
import { ensureSchema } from "../../test/ensure-schema";

import { ModerationModule } from "./moderation.module";

/**
 * E2E spec for the moderation module (EP-6 `POST /api/v1/kudos/:id/hide`)
 * against the docker-compose PostgreSQL.
 *
 * ## Test module
 *
 * Following the repo's e2e convention this spec mounts the feature module
 * under test plus the foundation it needs — `PrismaModule` and the two guards —
 * and **not** `AppModule`. `KudosModule` is imported as well because both ACs
 * are phrased over `GET /api/v1/kudos` ("absent from" / "stays present in the
 * list response"): the board read path that excludes soft-hidden rows is what
 * the hide action has to be proven against, so the real `KudosController` is
 * mounted rather than a stand-in probe route.
 *
 * ## Roster
 *
 * The known accounts of T-4's deterministic seed roster (`prisma/seed.ts`:
 * `lead@team.co` LEAD, `maya@team.co` / `priya@team.co` MEMBER) are converged
 * with an idempotent `upsert` keyed on the unique email — exactly the write
 * `prisma db seed` performs — so the spec runs against the seeded database
 * whether or not the seed script has already been executed.
 *
 * The auth module is deliberately not imported: `SessionGuard` resolves the
 * session straight from the `sessions` table, so this suite authenticates by
 * inserting a `Session` row per account and sending that id as the httpOnly
 * session cookie (same approach as `kudos.e2e-spec.ts`).
 */

/** `MemberRole` values of `prisma/schema.prisma`, spelled out locally. */
type MemberRoleValue = "MEMBER" | "LEAD";

/** `ReactionEmoji` values of `prisma/schema.prisma`, spelled out locally. */
type ReactionEmojiValue = "THUMBS_UP" | "HEART" | "TADA" | "RAISED_HANDS";

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
  };
  readonly kudos: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{ hiddenAt: Date | null } | null>;
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args: {
      where: { message: { startsWith: string } };
    }): Promise<number>;
  };
  readonly reaction: {
    create(args: {
      data: { kudosId: string; memberId: string; emoji: ReactionEmojiValue };
    }): Promise<{ id: string }>;
    count(args: { where: { kudosId: string } }): Promise<number>;
  };
  readonly session: {
    create(args: {
      data: { id: string; memberId: string; expiresAt: Date };
    }): Promise<{ id: string }>;
    deleteMany(args: {
      where: { id: { in: readonly string[] } };
    }): Promise<number>;
  };
}

/** The seeded team lead (T-4 roster, ADR-2 / Q-2). */
const LEAD_EMAIL = "lead@team.co";

/** The two seeded regular members (T-4 roster, ADR-2 / Q-5). */
const MAYA_EMAIL = "maya@team.co";
const PRIYA_EMAIL = "priya@team.co";

/** Opaque session ids, unique to this spec. */
const LEAD_SESSION_ID = "t8-lead-session";
const MAYA_SESSION_ID = "t8-maya-session";
const PRIYA_SESSION_ID = "t8-priya-session";

/** Every session this spec inserts, so `afterAll` can remove exactly those. */
const SESSION_IDS: readonly string[] = [
  LEAD_SESSION_ID,
  MAYA_SESSION_ID,
  PRIYA_SESSION_ID,
];

/** Every account whose board view the ACs assert over. */
const ALL_SESSION_IDS: readonly string[] = [
  MAYA_SESSION_ID,
  PRIYA_SESSION_ID,
  LEAD_SESSION_ID,
];

/** Every regular-member session — the accounts that must get 403 (AC-18). */
const MEMBER_SESSION_IDS: readonly string[] = [
  MAYA_SESSION_ID,
  PRIYA_SESSION_ID,
];

/**
 * Marks — and therefore scopes the cleanup of — every kudos row this spec
 * creates, so a shared dev database keeps everybody else's data.
 */
const FIXTURE_MESSAGE_PREFIX = "T-8 moderation fixture";

/**
 * Password for the fixture accounts on the *create* branch of the roster
 * upsert. It is passed through `hashPassword` before it reaches the database
 * (NFR: a plaintext password is never persisted), and nothing here ever signs
 * in with it — the spec authenticates through inserted session rows.
 */
const FIXTURE_PASSWORD = "t8-moderation-fixture-password";

/** The board read both ACs are phrased over. */
const KUDOS_PATH = "/api/v1/kudos";

/** Upper bound on the pages walked by {@link boardIds}: 25 x 20 = 500 rows. */
const MAX_PAGES = 25;

/** `POST /api/v1/kudos/:id/hide` for a given kudos id. */
const hidePath = (kudosId: string): string => `${KUDOS_PATH}/${kudosId}/hide`;

/** `Cookie` header value carrying the given session id. */
const cookieOf = (sessionId: string): string =>
  `${DEFAULT_SESSION_COOKIE_NAME}=${sessionId}`;

describe("Moderation (EP-6 POST /api/v1/kudos/:id/hide) e2e", () => {
  let app: INestApplication;
  let prisma: TestPrismaClient;
  let leadId: string;
  let mayaId: string;
  let priyaId: string;

  /** The endpoint under test, authenticated with the given cookie. */
  const hide = (kudosId: string, cookie: string) =>
    request(app.getHttpServer())
      .post(hidePath(kudosId))
      .set("Cookie", cookie);

  /** `POST /api/v1/kudos` as the given session, thanking the lead. */
  const postKudos = (sessionId: string, message: string) =>
    request(app.getHttpServer())
      .post(KUDOS_PATH)
      .set("Cookie", cookieOf(sessionId))
      .send({ recipient: LEAD_EMAIL, message });

  /**
   * Every kudos id the board returns to the given session, across all pages.
   *
   * "Absent from GET /api/v1/kudos" must mean absent from the *whole* board,
   * not just page 1, and "still present" must not pass merely because the row
   * happens to sit on a later page of a busy shared database — so the pages are
   * walked until one comes back empty.
   */
  const boardIds = async (sessionId: string): Promise<string[]> => {
    const ids: string[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const response = await request(app.getHttpServer())
        .get(`${KUDOS_PATH}?page=${page}`)
        .set("Cookie", cookieOf(sessionId))
        .expect(200);

      const rows = response.body as { id: string }[];
      if (!Array.isArray(rows) || rows.length === 0) {
        break;
      }

      ids.push(...rows.map((row) => row.id));
    }

    return ids;
  };

  /** Reads `hiddenAt` of one kudos row straight from the database. */
  const hiddenAtOf = async (
    kudosId: string,
  ): Promise<Date | null | undefined> => {
    const row = await prisma.kudos.findUnique({ where: { id: kudosId } });
    return row === null ? undefined : row.hiddenAt;
  };

  /** Removes only this spec's kudos rows (their reactions cascade away). */
  const cleanFixtures = async (): Promise<void> => {
    await prisma.kudos.deleteMany({
      where: { message: { startsWith: FIXTURE_MESSAGE_PREFIX } },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // ModerationModule is the module under test; KudosModule supplies the
      // real board read both ACs assert against; PrismaModule is the
      // persistence foundation and the two guards the auth foundation.
      imports: [ModerationModule, KudosModule, PrismaModule],
      providers: [
        SessionGuard,
        RolesGuard,
        { provide: APP_CONFIG, useFactory: appConfig },
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    // Mirrors `src/main.ts` so the HTTP surface under test is identical to the
    // running application's.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
      }),
    );

    await app.init();

    prisma = app.get(PrismaService) as unknown as TestPrismaClient;

    // Nothing in the workspace applies `prisma/migrations`, so make sure the
    // schema exists before touching any table. A no-op when already migrated.
    await ensureSchema(app.get(PrismaService));

    // Converge the T-4 roster in place: the same idempotent, email-keyed
    // upsert `prisma db seed` performs. An already-seeded row keeps its
    // password hash — only `role` is rewritten, to the value the seed holds.
    const passwordHash = await hashPassword(FIXTURE_PASSWORD);
    const upsert = (email: string, role: MemberRoleValue) =>
      prisma.member.upsert({
        where: { email },
        update: { role },
        create: { email, role, passwordHash },
      });

    const [lead, maya, priya] = await Promise.all([
      upsert(LEAD_EMAIL, "LEAD"),
      upsert(MAYA_EMAIL, "MEMBER"),
      upsert(PRIYA_EMAIL, "MEMBER"),
    ]);

    leadId = lead.id;
    mayaId = maya.id;
    priyaId = priya.id;

    // Sessions are inserted directly: the auth module is not under test here,
    // and `SessionGuard` resolves the cookie value from the `sessions` table.
    await prisma.session.deleteMany({ where: { id: { in: SESSION_IDS } } });

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await Promise.all([
      prisma.session.create({
        data: { id: LEAD_SESSION_ID, memberId: leadId, expiresAt },
      }),
      prisma.session.create({
        data: { id: MAYA_SESSION_ID, memberId: mayaId, expiresAt },
      }),
      prisma.session.create({
        data: { id: PRIYA_SESSION_ID, memberId: priyaId, expiresAt },
      }),
    ]);

    await cleanFixtures();
  });

  beforeEach(async () => {
    // Each AC starts from a board free of this spec's earlier rows.
    await cleanFixtures();
  });

  afterAll(async () => {
    // Only what this spec itself wrote. The seeded roster accounts are left in
    // place — they belong to T-4's seed, not to this spec.
    await cleanFixtures();
    await prisma.session.deleteMany({ where: { id: { in: SESSION_IDS } } });
    await app.close();
  });

  it("[AC-17] a lead hiding a kudos gets a 2xx response and the kudos is afterwards absent from the board list for every member account", async () => {
    // A kudos posted through the real endpoint by a regular member, so the row
    // under moderation is exactly what the board would show.
    const created = await postKudos(
      MAYA_SESSION_ID,
      `${FIXTURE_MESSAGE_PREFIX} AC-17 target`,
    ).expect(201);

    const kudosId = created.body.id as string;
    expect(typeof kudosId).toBe("string");
    expect(kudosId.length).toBeGreaterThan(0);

    // A reaction sits on the row before the hide: ADR-5 requires the row *and
    // its reactions* to be retained, so this count has to survive the hide.
    await prisma.reaction.create({
      data: { kudosId, memberId: priyaId, emoji: "THUMBS_UP" },
    });
    expect(await prisma.reaction.count({ where: { kudosId } })).toBe(1);

    // Visible to every account before the hide — otherwise "absent afterwards"
    // would prove nothing about the hide at all.
    for (const sessionId of ALL_SESSION_IDS) {
      expect(await boardIds(sessionId)).toContain(kudosId);
    }

    // --- the lead calls the hide endpoint and gets a 2xx response ---
    const hidden = await hide(kudosId, cookieOf(LEAD_SESSION_ID));
    expect(hidden.status).toBe(200);

    // The body is the hidden kudos' id and nothing else: no `hiddenAt`, no
    // `hiddenBy` — hidden state beyond the lead review variant of the board
    // endpoint (owned by the kudos module) must not leak (ADR-7).
    expect(hidden.body).toEqual({ id: kudosId });
    expect(hidden.body).not.toHaveProperty("hiddenAt");
    expect(hidden.body).not.toHaveProperty("hiddenBy");

    // --- the kudos is afterwards absent from the board for every member ---
    for (const sessionId of ALL_SESSION_IDS) {
      expect(await boardIds(sessionId)).not.toContain(kudosId);
    }

    // --- soft hide only: the row and its reactions are retained (ADR-5) ---
    expect(await prisma.kudos.count({ where: { id: kudosId } })).toBe(1);
    expect(await hiddenAtOf(kudosId)).not.toBeNull();
    expect(await prisma.reaction.count({ where: { kudosId } })).toBe(1);

    // --- idempotent: hiding the already-hidden kudos is still a 2xx ---
    const again = await hide(kudosId, cookieOf(LEAD_SESSION_ID));
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id: kudosId });
    expect(await boardIds(MAYA_SESSION_ID)).not.toContain(kudosId);

    // The first hide's timestamp survives: the repeat call is a no-op write.
    const firstHiddenAt = await hiddenAtOf(kudosId);
    await hide(kudosId, cookieOf(LEAD_SESSION_ID)).expect(200);
    expect(await hiddenAtOf(kudosId)).toEqual(firstHiddenAt);

    // --- an unknown kudos id is a 404, never a silent success ---
    const unknown = await hide("t8-no-such-kudos", cookieOf(LEAD_SESSION_ID));
    expect(unknown.status).toBe(404);
    expect(unknown.body.statusCode).toBe(404);

    // The three fixture accounts really are three distinct members.
    expect(mayaId).not.toBe(priyaId);
    expect(leadId).not.toBe(mayaId);
    expect(leadId).not.toBe(priyaId);
  });

  it("[AC-18] a member without the lead role gets 403 and the kudos stays present in the list response", async () => {
    const created = await postKudos(
      PRIYA_SESSION_ID,
      `${FIXTURE_MESSAGE_PREFIX} AC-18 target`,
    ).expect(201);

    const kudosId = created.body.id as string;

    // No session cookie at all: the NFR makes every moderation endpoint a 401
    // without a valid session — checked first, so the 403s below are known to
    // come from the *role* check rather than from a missing session.
    const anonymous = await request(app.getHttpServer()).post(
      hidePath(kudosId),
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.statusCode).toBe(401);

    // --- each regular MEMBER account is refused with 403, not 401 ---
    for (const sessionId of MEMBER_SESSION_IDS) {
      const refused = await hide(kudosId, cookieOf(sessionId));
      expect(refused.status).toBe(403);
      expect(refused.body.statusCode).toBe(403);
    }

    // Nothing was written: the row is still un-hidden in the database.
    expect(await hiddenAtOf(kudosId)).toBeNull();

    // --- the kudos remains visible on the board, for members and lead alike ---
    for (const sessionId of ALL_SESSION_IDS) {
      expect(await boardIds(sessionId)).toContain(kudosId);
    }

    // The refused calls persisted no hide at all.
    expect(
      await prisma.kudos.count({
        where: { id: kudosId, hiddenAt: { not: null } },
      }),
    ).toBe(0);
  });
});
