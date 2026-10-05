import { readFileSync } from "fs";
import { join } from "path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { ReactionsModule } from "./reactions.module";
import {
  HEART_EMOJI,
  RAISED_HANDS_EMOJI,
  TADA_EMOJI,
  THUMBS_UP_EMOJI,
} from "./dto/set-reaction.dto";

/**
 * Reactions e2e specs (T-7, EP-5): `PUT /api/v1/kudos/:id/reactions`.
 *
 * One `it()` block per acceptance criterion, tagged `[AC-n]` so the Eval stage
 * can attribute evidence to exactly the right criterion.
 *
 * The auth module is deliberately **not** a dependency: a session is created by
 * inserting a `Session` row through `PrismaService` and presenting its id as
 * the `kudos_session` cookie, which is exactly what `POST /auth/login` issues
 * (ADR-1). Members and kudos are likewise written straight through Prisma, so
 * these specs pin the reaction behaviour itself and not the seed script.
 *
 * Every fixture is scoped to this run: spec files run in parallel workers
 * against one database, so nothing here deletes or counts rows it did not
 * create itself.
 *
 * Three further blocks (untagged: no AC of this task covers them) pin the rest
 * of the endpoint contract from the task description - 401 without a session,
 * 404 for an unknown kudos id, and 400 for an emoji outside the curated set.
 */

/** Cookie name the guard reads; mirrors `SESSION_COOKIE_NAME` (ADR-1). */
const SESSION_COOKIE = "kudos_session";

/** Unique-per-run email prefix so these fixtures can never collide with seeds. */
const RUN = `t7-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A member created for this spec run. */
interface TestMember {
  readonly id: string;
  readonly email: string;
}

/** One kudos row as the tests read it back from Prisma. */
interface SeededKudos {
  readonly id: string;
  readonly message: string;
}

/** A single reaction aggregate in the ADR-7 kudos response. */
interface ReactionSummary {
  readonly emoji: string;
  readonly count: number;
  readonly mine: boolean;
}

/** The initial migration T-2 owns; applied verbatim when the database is empty. */
const INIT_MIGRATION_PATH = join(
  __dirname,
  "..",
  "..",
  "prisma",
  "migrations",
  "20240101000000_init",
  "migration.sql",
);

/** The tables the reactions feature reads and writes. */
const REQUIRED_TABLES = ["Member", "Kudos", "Reaction", "Session"];

describe("Reactions: PUT /api/v1/kudos/:id/reactions (T-7)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  /**
   * Every member this run has created, ever - the scoping key for every delete
   * and count below, so parallel spec files cannot observe or destroy each
   * other's fixtures.
   */
  const runMemberIds: string[] = [];
  /** Members still to remove; emptied as they are deleted (cascading). */
  const pendingMemberIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // The reactions feature plus the Prisma and guard foundation it builds
      // on. `SessionGuard` is applied on the controller itself, so it is
      // resolved from `ReactionsModule` and needs no explicit provider here.
      imports: [PrismaModule, ReactionsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    await prisma.$connect();
    await ensureSchema();
  });

  afterAll(async () => {
    try {
      await removeRunMembers();
    } finally {
      await app.close();
    }
  });

  beforeEach(async () => {
    // Defensive reset: kudos authored by *this run's* members only (reactions
    // cascade from kudos), so a leftover from a failed block cannot leak into
    // the next one - and no other spec file's rows are touched.
    if (runMemberIds.length > 0) {
      await prisma.kudos.deleteMany({
        where: { authorId: { in: runMemberIds } },
      });
    }
  });

  afterEach(async () => {
    await removeRunMembers();
  });

  /**
   * Guarantees the Prisma schema exists before any fixture is written.
   *
   * A freshly started docker-compose PostgreSQL has no tables until
   * `prisma migrate deploy` runs, and these specs must be runnable straight
   * from `pnpm --filter api test -- reactions`. When a table is missing the
   * initial migration is applied verbatim - it is the schema's source of
   * truth, so the spec never drifts from it. An already-migrated database is
   * left untouched.
   */
  async function ensureSchema(): Promise<void> {
    const missing = await missingTables();
    if (missing.length === 0) return;

    const statements = readFileSync(INIT_MIGRATION_PATH, "utf8")
      // Comment lines would otherwise leave empty, unexecutable chunks behind.
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement !== "");

    for (const statement of statements) {
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A partially-migrated database may already hold some objects; only an
        // "already exists" is tolerable, anything else is a real failure.
        if (!/already exists/i.test(message)) {
          throw error;
        }
      }
    }
  }

  /** The subset of {@link REQUIRED_TABLES} that is absent from `public`. */
  async function missingTables(): Promise<string[]> {
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const present = new Set(rows.map((row) => row.table_name));
    return REQUIRED_TABLES.filter((table) => !present.has(table));
  }

  /** Deletes the members this run created; their kudos and sessions cascade. */
  async function removeRunMembers(): Promise<void> {
    if (pendingMemberIds.length === 0) return;
    const ids = [...pendingMemberIds];
    pendingMemberIds.length = 0;
    await prisma.session.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.member.deleteMany({ where: { id: { in: ids } } });
  }

  /** Creates a unique member fixture. */
  async function createMember(localPart: string): Promise<TestMember> {
    const email = `${RUN}-${localPart}@kudos.local`;
    const member = await prisma.member.create({
      data: { email, passwordHash: "test-only-hash", role: "MEMBER" },
      select: { id: true, email: true },
    });
    runMemberIds.push(member.id);
    pendingMemberIds.push(member.id);
    return member;
  }

  /**
   * Inserts a server-side session for `member` and returns the `Cookie` header
   * that presents it. This is the ADR-1 credential - no auth endpoint needed.
   */
  async function sessionCookieFor(member: TestMember): Promise<string> {
    const session = await prisma.session.create({
      data: {
        id: `sess-${RUN}-${Math.random().toString(36).slice(2, 12)}`,
        memberId: member.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    return `${SESSION_COOKIE}=${session.id}`;
  }

  /** Inserts one visible kudos row authored by `author` thanking `recipient`. */
  async function seedKudos(
    author: TestMember,
    recipient: TestMember,
    message: string,
  ): Promise<SeededKudos> {
    return prisma.kudos.create({
      data: {
        authorId: author.id,
        recipientId: recipient.id,
        message,
      },
      select: { id: true, message: true },
    });
  }

  it("[AC-14] a signed-in member's first reaction returns 2xx and that emoji at count 1 with mine true", async () => {
    const author = await createMember("author-ac14");
    const recipient = await createMember("recipient-ac14");
    const reactor = await createMember("reactor-ac14");
    const cookie = await sessionCookieFor(reactor);
    const kudos = await seedKudos(author, recipient, "saved the release");

    const response = await request(app.getHttpServer())
      .put(`/api/v1/kudos/${kudos.id}/reactions`)
      .set("Cookie", cookie)
      .send({ emoji: THUMBS_UP_EMOJI });

    // A first reaction succeeds (AC-14 accepts any 2xx).
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);

    // The response is the uniform kudos resource (ADR-7)...
    expect(response.body.id).toBe(kudos.id);
    expect(response.body.message).toBe(kudos.message);
    expect(response.body.recipient).toBe(recipient.email);
    expect(response.body.author).toEqual({
      id: author.id,
      email: author.email,
    });
    expect(new Date(response.body.createdAt).toString()).not.toBe(
      "Invalid Date",
    );

    // ...and the reaction appears exactly once, flagged as the caller's own.
    const reactions: ReactionSummary[] = response.body.reactions;
    expect(reactions).toHaveLength(1);
    expect(reactions[0]).toEqual({
      emoji: THUMBS_UP_EMOJI,
      count: 1,
      mine: true,
    });

    // Exactly one row was persisted, holding the ReactionEmoji enum value.
    const stored = await prisma.reaction.findMany({
      where: { kudosId: kudos.id },
      select: { memberId: true, emoji: true },
    });
    expect(stored).toEqual([{ memberId: reactor.id, emoji: "THUMBS_UP" }]);
  });

  it("[AC-15] re-submitting the same or a different emoji leaves exactly one reaction from that member", async () => {
    const author = await createMember("author-ac15");
    const recipient = await createMember("recipient-ac15");
    const reactor = await createMember("reactor-ac15");
    const cookie = await sessionCookieFor(reactor);
    const kudos = await seedKudos(author, recipient, "paired with me all week");

    // 1st submit: creates the row.
    const first = await request(app.getHttpServer())
      .put(`/api/v1/kudos/${kudos.id}/reactions`)
      .set("Cookie", cookie)
      .send({ emoji: HEART_EMOJI });
    expect(first.status).toBeLessThan(300);
    expect(first.body.reactions).toEqual([
      { emoji: HEART_EMOJI, count: 1, mine: true },
    ]);

    // 2nd submit, same emoji: still exactly one reaction, nothing duplicated.
    const same = await request(app.getHttpServer())
      .put(`/api/v1/kudos/${kudos.id}/reactions`)
      .set("Cookie", cookie)
      .send({ emoji: HEART_EMOJI });
    expect(same.status).toBeLessThan(300);
    expect(same.body.reactions).toEqual([
      { emoji: HEART_EMOJI, count: 1, mine: true },
    ]);

    // 3rd submit, a different emoji: the previous reaction is *replaced*...
    const replaced = await request(app.getHttpServer())
      .put(`/api/v1/kudos/${kudos.id}/reactions`)
      .set("Cookie", cookie)
      .send({ emoji: TADA_EMOJI });
    expect(replaced.status).toBeLessThan(300);
    expect(replaced.body.reactions).toEqual([
      { emoji: TADA_EMOJI, count: 1, mine: true },
    ]);

    // ...and the database holds exactly one row for that member, with the
    // latest emoji - never a duplicate.
    const stored = await prisma.reaction.findMany({
      where: { kudosId: kudos.id },
      select: { memberId: true, emoji: true },
    });
    expect(stored).toEqual([{ memberId: reactor.id, emoji: "TADA" }]);
    expect(
      await prisma.reaction.count({
        where: { kudosId: kudos.id, memberId: reactor.id },
      }),
    ).toBe(1);
  });

  it("[AC-16] two different members reacting with the same emoji on one kudos yields that emoji at count 2", async () => {
    const author = await createMember("author-ac16");
    const recipient = await createMember("recipient-ac16");
    const first = await createMember("first-ac16");
    const second = await createMember("second-ac16");
    const firstCookie = await sessionCookieFor(first);
    const secondCookie = await sessionCookieFor(second);
    const kudos = await seedKudos(author, recipient, "carried the on-call");

    const firstResponse = await request(app.getHttpServer())
      .put(`/api/v1/kudos/${kudos.id}/reactions`)
      .set("Cookie", firstCookie)
      .send({ emoji: TADA_EMOJI });
    expect(firstResponse.status).toBeLessThan(300);

    const secondResponse = await request(app.getHttpServer())
      .put(`/api/v1/kudos/${kudos.id}/reactions`)
      .set("Cookie", secondCookie)
      .send({ emoji: TADA_EMOJI });
    expect(secondResponse.status).toBeLessThan(300);

    // Two distinct rows - one per member - both on the same emoji.
    const stored = await prisma.reaction.findMany({
      where: { kudosId: kudos.id },
      select: { memberId: true, emoji: true },
    });
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map((row) => row.memberId))).toEqual(
      new Set([first.id, second.id]),
    );
    expect(stored.every((row) => row.emoji === "TADA")).toBe(true);

    // The second member's response already reports the aggregated count of 2.
    expect(secondResponse.body.reactions).toEqual([
      { emoji: TADA_EMOJI, count: 2, mine: true },
    ]);

    // So does the first member's *current* view: re-submitting the same emoji
    // is an idempotent no-op upsert on her/his single row, so it returns the
    // kudos with both reactions without adding a third one.
    const firstAgain = await request(app.getHttpServer())
      .put(`/api/v1/kudos/${kudos.id}/reactions`)
      .set("Cookie", firstCookie)
      .send({ emoji: TADA_EMOJI });
    expect(firstAgain.status).toBeLessThan(300);
    expect(firstAgain.body.reactions).toEqual([
      { emoji: TADA_EMOJI, count: 2, mine: true },
    ]);
    expect(
      await prisma.reaction.count({ where: { kudosId: kudos.id } }),
    ).toBe(2);

    // `mine` is relative to the caller: a member who reacted with a *different*
    // emoji still sees the count-2 group, but it is not hers/his.
    const other = await createMember("other-ac16");
    const otherCookie = await sessionCookieFor(other);
    const otherResponse = await request(app.getHttpServer())
      .put(`/api/v1/kudos/${kudos.id}/reactions`)
      .set("Cookie", otherCookie)
      .send({ emoji: RAISED_HANDS_EMOJI });
    expect(otherResponse.status).toBeLessThan(300);
    expect(otherResponse.body.reactions).toContainEqual({
      emoji: TADA_EMOJI,
      count: 2,
      mine: false,
    });
    expect(otherResponse.body.reactions).toContainEqual({
      emoji: RAISED_HANDS_EMOJI,
      count: 1,
      mine: true,
    });
  });

  it("PUT without a session cookie returns 401", async () => {
    const author = await createMember("author-unauth");
    const recipient = await createMember("recipient-unauth");
    const kudos = await seedKudos(author, recipient, "unauthenticated target");

    const response = await request(app.getHttpServer())
      .put(`/api/v1/kudos/${kudos.id}/reactions`)
      .send({ emoji: THUMBS_UP_EMOJI });

    expect(response.status).toBe(401);
    expect(response.body.statusCode).toBe(401);

    // Nothing was persisted by the rejected request.
    expect(await prisma.reaction.count({ where: { kudosId: kudos.id } })).toBe(
      0,
    );
  });

  it("PUT for an unknown kudos id returns 404", async () => {
    const member = await createMember("member-404");
    const cookie = await sessionCookieFor(member);

    const response = await request(app.getHttpServer())
      .put("/api/v1/kudos/does-not-exist/reactions")
      .set("Cookie", cookie)
      .send({ emoji: THUMBS_UP_EMOJI });

    expect(response.status).toBe(404);
    expect(response.body.statusCode).toBe(404);

    // Scoped to this run's members so a parallel spec cannot skew the count.
    expect(
      await prisma.reaction.count({
        where: { memberId: { in: runMemberIds } },
      }),
    ).toBe(0);
  });

  it("PUT with an emoji outside the curated set returns 400 and persists nothing", async () => {
    const author = await createMember("author-400");
    const recipient = await createMember("recipient-400");
    const member = await createMember("member-400");
    const cookie = await sessionCookieFor(member);
    const kudos = await seedKudos(author, recipient, "validation target");

    for (const emoji of ["🔥", "thumbs_up", ""]) {
      const response = await request(app.getHttpServer())
        .put(`/api/v1/kudos/${kudos.id}/reactions`)
        .set("Cookie", cookie)
        .send({ emoji });

      expect(response.status).toBe(400);
      expect(response.body.message).toBeDefined();
    }

    // A missing `emoji` field is likewise a client error, never a silent drop.
    const missing = await request(app.getHttpServer())
      .put(`/api/v1/kudos/${kudos.id}/reactions`)
      .set("Cookie", cookie)
      .send({});
    expect(missing.status).toBe(400);

    // None of the rejected payloads wrote a reaction row.
    expect(await prisma.reaction.count({ where: { kudosId: kudos.id } })).toBe(
      0,
    );
  });
});
