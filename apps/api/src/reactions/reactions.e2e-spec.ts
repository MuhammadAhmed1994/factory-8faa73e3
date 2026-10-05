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
  REACTION_EMOJIS,
} from "@/app.config";
import { SessionGuard } from "@/common/guards/session.guard";
import { PrismaModule } from "@/prisma/prisma.module";
import { PrismaService } from "@/prisma/prisma.service";

import { ReactionsModule } from "./reactions.module";
import { ensureSchema } from "../../test/ensure-schema";

/**
 * E2E spec for the reactions module (EP-5
 * `PUT /api/v1/kudos/:id/reactions`) against the docker-compose PostgreSQL.
 *
 * Per the e2e convention this spec imports only `ReactionsModule` plus the
 * Prisma/session-guard foundation — not `AppModule` and not the kudos feature
 * module. `SessionGuard` resolves the session straight from the `sessions`
 * table, so this suite authenticates by inserting a `Session` row per member
 * and sending that id as the httpOnly session cookie: no login round-trip and
 * no cross-task dependency. The kudos rows under test are seeded directly,
 * which also keeps the *read* path under test honest — nothing here depends on
 * `POST /api/v1/kudos` having been implemented a particular way.
 *
 * A `Test.createNestApplication()` does not inherit `src/main.ts`'s wiring, so
 * the one piece that changes the answers under test is reproduced here: the
 * `ValidationPipe` whose `exceptionFactory` maps an invalid body to a **400**
 * `BadRequestException`. The `/api/v1` prefix lives on the controller itself.
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
      };
    }): Promise<{ id: string }>;
    deleteMany(args?: { where?: unknown }): Promise<number>;
  };
  readonly reaction: {
    count(args?: { where?: unknown }): Promise<number>;
    deleteMany(args?: { where?: unknown }): Promise<number>;
    findMany(args?: {
      where?: unknown;
      select?: unknown;
    }): Promise<
      { kudosId: string; memberId: string; emoji: ReactionEmojiValue }[]
    >;
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

/**
 * The curated characters, taken from the same `REACTION_EMOJIS` constant the
 * DTO validates against (never retyped here), so the two can never drift apart.
 */
const [THUMBS_UP, HEART, TADA, RAISED_HANDS] = REACTION_EMOJIS;

/** An emoji deliberately outside the curated set (ADR-4 rejects it with 400). */
const UNCURATED_EMOJI = "🔥";

/** Members this spec owns; `afterAll` removes them and, by cascade, their data. */
const MEMBER_EMAIL = "t7-member@kudos.test";
const COLLEAGUE_EMAIL = "t7-colleague@kudos.test";
const FIXTURE_EMAILS: readonly string[] = [MEMBER_EMAIL, COLLEAGUE_EMAIL];

/** Opaque session ids, unique to this spec. */
const MEMBER_SESSION_ID = "t7-member-session-id";
const COLLEAGUE_SESSION_ID = "t7-colleague-session-id";

/** One kudos as the API returns it (ADR-7). */
interface KudosPayload {
  id: string;
  recipient: string;
  message: string;
  author: { id: string; email: string };
  createdAt: string;
  reactions: { emoji: string; count: number; mine: boolean }[];
}

/** One entry of the `message` array a validation 400 carries. */
interface ValidationFailure {
  readonly property: string;
  readonly constraints?: Record<string, string>;
}

/** Reads the `message` array of a validation 400, asserting its shape. */
const failuresOf = (body: unknown): ValidationFailure[] => {
  expect(Array.isArray((body as { message?: unknown }).message)).toBe(true);
  return (body as { message: ValidationFailure[] }).message;
};

describe("Reactions module (EP-5) e2e", () => {
  let app: INestApplication;
  let prisma: TestPrismaClient;
  let memberId: string;
  let colleagueId: string;
  let kudosId: string;

  /** `Cookie` header authenticating as the reacting member. */
  const memberCookie = (): string =>
    `${DEFAULT_SESSION_COOKIE_NAME}=${MEMBER_SESSION_ID}`;

  /** `Cookie` header authenticating as the second, different member. */
  const colleagueCookie = (): string =>
    `${DEFAULT_SESSION_COOKIE_NAME}=${COLLEAGUE_SESSION_ID}`;

  /** `PUT /api/v1/kudos/:id/reactions` with an emoji body. */
  const putReaction = (
    id: string,
    emoji: string,
    cookie: string | null = memberCookie(),
  ) => {
    const req = request(app.getHttpServer())
      .put(`/api/v1/kudos/${id}/reactions`)
      .send({ emoji });
    return cookie === null ? req : req.set("Cookie", cookie);
  };

  /** Removes this spec's kudos rows (their reactions cascade away with them). */
  const cleanBoard = async (): Promise<void> => {
    await prisma.reaction.deleteMany({
      where: { memberId: { in: [memberId, colleagueId] } },
    });
    await prisma.kudos.deleteMany({
      where: {
        OR: [
          { authorId: { in: [memberId, colleagueId] } },
          { recipientId: { in: [memberId, colleagueId] } },
        ],
      },
    });
  };

  /** Inserts one fresh kudos row and returns its id. */
  const seedKudos = async (message: string): Promise<string> => {
    const created = await prisma.kudos.create({
      data: {
        authorId: colleagueId,
        recipientId: memberId,
        message,
      },
    });
    return created.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // ReactionsModule brings its controller/service; PrismaModule is the
      // persistence foundation and SessionGuard the auth foundation.
      imports: [ReactionsModule, PrismaModule],
      providers: [
        SessionGuard,
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

    await prisma.session.deleteMany({
      where: {
        id: { in: [MEMBER_SESSION_ID, COLLEAGUE_SESSION_ID] },
      },
    });

    const upsert = (email: string, role: MemberRoleValue) =>
      prisma.member.upsert({
        where: { email },
        update: { role },
        create: { email, role, passwordHash: PLACEHOLDER_HASH },
      });

    const member = await upsert(MEMBER_EMAIL, "MEMBER");
    const colleague = await upsert(COLLEAGUE_EMAIL, "MEMBER");

    memberId = member.id;
    colleagueId = colleague.id;

    // Sessions are inserted directly: the auth module is not under test here.
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.session.create({
      data: { id: MEMBER_SESSION_ID, memberId, expiresAt },
    });
    await prisma.session.create({
      data: { id: COLLEAGUE_SESSION_ID, memberId: colleagueId, expiresAt },
    });

    await cleanBoard();
  });

  beforeEach(async () => {
    // Every AC starts from a kudos with no reactions of its own.
    await cleanBoard();
    kudosId = await seedKudos("Thanks for carrying the release!");
  });

  afterAll(async () => {
    // Deleting the fixture members cascades away their kudos, reactions and
    // sessions.
    await prisma.member.deleteMany({ where: { email: { in: FIXTURE_EMAILS } } });
    await app.close();
  });

  it("[AC-14] a signed-in seeded member's first reaction returns 2xx and the returned kudos shows that emoji at count 1 with mine true", async () => {
    // --- the endpoint contract around the happy path, so the 2xx below is
    // --- attributable to the session and the curated set, not to a leaky route.

    // No session cookie: the guard answers 401 before any handler runs.
    const anonymous = await putReaction(kudosId, TADA, null).expect(401);
    expect(anonymous.body.statusCode).toBe(401);
    expect(await prisma.reaction.count({ where: { kudosId } })).toBe(0);

    // An emoji outside the curated set: the global pipe answers 400 and the
    // offending field is named.
    const uncurated = await putReaction(kudosId, UNCURATED_EMOJI).expect(400);
    expect(
      failuresOf(uncurated.body).some(
        (failure) => failure.property === "emoji",
      ),
    ).toBe(true);
    expect(await prisma.reaction.count({ where: { kudosId } })).toBe(0);

    // An unknown kudos id: 404, and reacting to nothing must not persist.
    const unknown = await putReaction("t7-no-such-kudos", TADA).expect(404);
    expect(unknown.body.statusCode).toBe(404);

    // --- the first reaction of this member on this kudos ---
    const response = await putReaction(kudosId, TADA).expect(200);

    const body = response.body as KudosPayload;

    // The whole payload is the uniform ADR-7 kudos resource.
    expect(body.id).toBe(kudosId);
    expect(body.message).toBe("Thanks for carrying the release!");
    expect(body.recipient).toBe(MEMBER_EMAIL);
    expect(body.author).toEqual({ id: colleagueId, email: COLLEAGUE_EMAIL });
    expect(Number.isNaN(new Date(body.createdAt).getTime())).toBe(false);

    // That emoji, count 1, and it is the caller's own reaction.
    expect(body.reactions).toEqual([{ emoji: TADA, count: 1, mine: true }]);

    // Exactly one row was persisted, for the session member, with the mapped
    // enum value rather than the character.
    expect(await prisma.reaction.count({ where: { kudosId } })).toBe(1);
    expect(
      await prisma.reaction.count({
        where: { kudosId, memberId, emoji: "TADA" },
      }),
    ).toBe(1);
  });

  it("[AC-15] re-submitting the same or a different emoji leaves exactly one reaction from that member, previous replaced, never duplicated", async () => {
    // First reaction.
    const first = await putReaction(kudosId, THUMBS_UP).expect(200);
    expect(first.body.reactions).toEqual([
      { emoji: THUMBS_UP, count: 1, mine: true },
    ]);

    // Re-submit the *same* emoji: still exactly one reaction from this member.
    const same = await putReaction(kudosId, THUMBS_UP).expect(200);
    expect(same.body.reactions).toEqual([
      { emoji: THUMBS_UP, count: 1, mine: true },
    ]);
    expect(
      await prisma.reaction.count({ where: { kudosId, memberId } }),
    ).toBe(1);

    // Re-submit with a *different* emoji: the previous reaction is replaced —
    // the old emoji disappears from the aggregate instead of accumulating.
    const changed = await putReaction(kudosId, HEART).expect(200);

    expect(changed.body.reactions).toEqual([
      { emoji: HEART, count: 1, mine: true },
    ]);
    expect(changed.body.reactions).toHaveLength(1);

    // In the database: one row for this member on this kudos, now HEART —
    // never a duplicate and never a stale THUMBS_UP.
    expect(
      await prisma.reaction.count({ where: { kudosId, memberId } }),
    ).toBe(1);
    expect(
      await prisma.reaction.count({
        where: { kudosId, memberId, emoji: "HEART" },
      }),
    ).toBe(1);
    expect(
      await prisma.reaction.count({
        where: { kudosId, memberId, emoji: "THUMBS_UP" },
      }),
    ).toBe(0);
    expect(await prisma.reaction.count({ where: { kudosId } })).toBe(1);

    // A third emoji keeps the invariant: still one row, only the latest emoji.
    const changedAgain = await putReaction(kudosId, RAISED_HANDS).expect(200);
    expect(changedAgain.body.reactions).toEqual([
      { emoji: RAISED_HANDS, count: 1, mine: true },
    ]);
    expect(await prisma.reaction.count({ where: { kudosId } })).toBe(1);
  });

  it("[AC-16] two different members reacting with the same emoji on one kudos yields that emoji at count 2", async () => {
    await putReaction(kudosId, TADA, memberCookie()).expect(200);
    await putReaction(kudosId, TADA, colleagueCookie()).expect(200);

    // Two distinct rows, one per member, both storing the same enum value.
    const rows = await prisma.reaction.findMany({
      where: { kudosId },
      select: { kudosId: true, memberId: true, emoji: true },
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.memberId))).toEqual(
      new Set([memberId, colleagueId]),
    );
    expect(rows.every((row) => row.emoji === "TADA")).toBe(true);

    // Each member sees the shared emoji at count 2, with their own reaction
    // flagged as `mine`.
    const asMember = (await putReaction(kudosId, TADA, memberCookie())
      .expect(200)) as { body: KudosPayload };
    expect(asMember.body.reactions).toEqual([
      { emoji: TADA, count: 2, mine: true },
    ]);

    const asColleague = (await putReaction(kudosId, TADA, colleagueCookie())
      .expect(200)) as { body: KudosPayload };
    expect(asColleague.body.reactions).toEqual([
      { emoji: TADA, count: 2, mine: true },
    ]);

    // No third member exists in this fixture, so no other emoji is aggregated.
    expect(await prisma.reaction.count({ where: { kudosId } })).toBe(2);
  });
});
