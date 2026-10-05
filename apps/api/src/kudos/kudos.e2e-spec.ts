import { readFileSync } from "fs";
import { join } from "path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PrismaService } from "../prisma/prisma.service";
import { PrismaModule } from "../prisma/prisma.module";
import { KudosModule } from "./kudos.module";
import { KUDOS_PAGE_SIZE } from "./dto/create-kudos.dto";

/**
 * Kudos board e2e specs (T-6, EP-3 / EP-4).
 *
 * One `it()` block per acceptance criterion, tagged `[AC-n]` so the Eval stage
 * can attribute evidence to exactly the right criterion.
 *
 * The auth module is deliberately **not** a dependency: a session is created by
 * inserting a `Session` row through `PrismaService` and presenting its id as
 * the `kudos_session` cookie, which is exactly what `POST /auth/login` issues
 * (ADR-1). The board is wiped before every test, because AC-11 asserts an exact
 * page split and could not tolerate leftovers from earlier blocks.
 *
 * Two further blocks (untagged: no AC of this task covers them) pin the rest of
 * the endpoint contract from the task description - that soft-hidden kudos are
 * excluded from the board, and that `?hidden=true` is the lead-only review
 * variant that answers 403 for a regular MEMBER.
 */

/** Cookie name the guard reads; mirrors `SESSION_COOKIE_NAME` (ADR-1). */
const SESSION_COOKIE = "kudos_session";

/** Unique-per-run email prefix so these fixtures can never collide with seeds. */
const RUN = `t6-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Roles a member can hold (mirrors the `MemberRole` Prisma enum). */
type SeedRole = "MEMBER" | "LEAD";

/** A member created for this spec run. */
interface TestMember {
  readonly id: string;
  readonly email: string;
}

/** One kudos row as the tests read it back from Prisma. */
interface SeededKudos {
  readonly id: string;
  readonly message: string;
  readonly createdAt: Date;
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

/** The tables the kudos feature reads and writes. */
const REQUIRED_TABLES = ["Member", "Kudos", "Reaction", "Session"];

describe("Kudos board: GET/POST /api/v1/kudos (T-6)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  /** Every member this run created, so they can be removed (cascading). */
  const createdMemberIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // The kudos feature plus the Prisma and guard foundation it builds on.
      // `SessionGuard` is applied on the controller itself, so it is resolved
      // from `KudosModule` and needs no explicit provider here.
      imports: [PrismaModule, KudosModule],
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
    // A clean board per test: AC-11 asserts an exact 20/5 split, which leftover
    // rows from an earlier block would break. Reactions cascade from kudos.
    await prisma.kudos.deleteMany({});
  });

  afterEach(async () => {
    await removeRunMembers();
  });

  /**
   * Guarantees the Prisma schema exists before any fixture is written.
   *
   * A freshly started docker-compose PostgreSQL has no tables until
   * `prisma migrate deploy` runs, and these specs must be runnable straight
   * from `pnpm --filter api test -- kudos`. When a table is missing the initial
   * migration is applied verbatim - it is the schema's source of truth, so the
   * spec never drifts from it. An already-migrated database is left untouched.
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
    if (createdMemberIds.length === 0) return;
    const ids = [...createdMemberIds];
    createdMemberIds.length = 0;
    await prisma.session.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.member.deleteMany({ where: { id: { in: ids } } });
  }

  /** Creates a unique member fixture with the given role. */
  async function createMember(
    localPart: string,
    role: SeedRole = "MEMBER",
  ): Promise<TestMember> {
    const email = `${RUN}-${localPart}@kudos.local`;
    const member = await prisma.member.create({
      data: { email, passwordHash: "test-only-hash", role },
      select: { id: true, email: true },
    });
    createdMemberIds.push(member.id);
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

  /** Inserts one kudos row with an explicit `createdAt` (for a stable order). */
  async function seedKudos(
    authorId: string,
    recipientId: string,
    message: string,
    createdAt: Date,
    hiddenAt: Date | null = null,
  ): Promise<SeededKudos> {
    return prisma.kudos.create({
      data: { authorId, recipientId, message, createdAt, hiddenAt },
      select: { id: true, message: true, createdAt: true },
    });
  }

  it("[AC-3] GET and POST /api/v1/kudos without a session cookie each return 401", async () => {
    const board = await request(app.getHttpServer()).get("/api/v1/kudos");
    expect(board.status).toBe(401);
    expect(board.body.statusCode).toBe(401);

    const posted = await request(app.getHttpServer())
      .post("/api/v1/kudos")
      .send({ recipient: "someone@kudos.local", message: "thanks!" });
    expect(posted.status).toBe(401);
    expect(posted.body.statusCode).toBe(401);

    // Nothing may be persisted by the unauthenticated POST.
    expect(await prisma.kudos.count({ where: { message: "thanks!" } })).toBe(0);
  });

  it("[AC-6] POST with a recipient and a message returns 201 with the created kudos", async () => {
    const author = await createMember("author-ac6");
    const recipient = await createMember("recipient-ac6");
    const cookie = await sessionCookieFor(author);
    const message = "Thank you for the flawless release week!";

    const response = await request(app.getHttpServer())
      .post("/api/v1/kudos")
      .set("Cookie", cookie)
      .send({ recipient: recipient.email, message });

    expect(response.status).toBe(201);

    // The uniform ADR-7 shape, with reactions empty until that module lands.
    expect(typeof response.body.id).toBe("string");
    expect(response.body.id).not.toBe("");
    expect(response.body.message).toBe(message);
    expect(response.body.recipient).toBe(recipient.email);
    expect(response.body.author).toEqual({
      id: author.id,
      email: author.email,
    });
    expect(typeof response.body.createdAt).toBe("string");
    expect(new Date(response.body.createdAt).toString()).not.toBe(
      "Invalid Date",
    );
    expect(Array.isArray(response.body.reactions)).toBe(true);

    // The row really was persisted with the session member as author.
    const stored = await prisma.kudos.findUnique({
      where: { id: response.body.id },
      select: { authorId: true, recipientId: true, message: true },
    });
    expect(stored).toEqual({
      authorId: author.id,
      recipientId: recipient.id,
      message,
    });
  });

  it("[AC-8] a 280-character message returns 201 while 281 characters returns 400 and persists nothing", async () => {
    const author = await createMember("author-ac8");
    const recipient = await createMember("recipient-ac8");
    const cookie = await sessionCookieFor(author);

    const validMessage = "x".repeat(280);
    const created = await request(app.getHttpServer())
      .post("/api/v1/kudos")
      .set("Cookie", cookie)
      .send({ recipient: recipient.email, message: validMessage });

    expect(created.status).toBe(201);
    expect(created.body.message).toBe(validMessage);
    expect(created.body.message).toHaveLength(280);

    const tooLong = "y".repeat(281);
    const rejected = await request(app.getHttpServer())
      .post("/api/v1/kudos")
      .set("Cookie", cookie)
      .send({ recipient: recipient.email, message: tooLong });

    expect(rejected.status).toBe(400);
    // A validation error is reported, not a bare 400 with no explanation.
    expect(rejected.body.message).toBeDefined();

    // Exactly the one valid row was persisted - the 281-char payload was not.
    const stored = await prisma.kudos.findMany({
      where: { authorId: author.id },
      select: { message: true },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].message).toBe(validMessage);
  });

  it("[AC-9] a missing recipient or an empty message returns 400 and creates no kudos", async () => {
    const author = await createMember("author-ac9");
    const recipient = await createMember("recipient-ac9");
    const cookie = await sessionCookieFor(author);

    const noRecipient = await request(app.getHttpServer())
      .post("/api/v1/kudos")
      .set("Cookie", cookie)
      .send({ message: "thank you" });
    expect(noRecipient.status).toBe(400);
    expect(noRecipient.body.message).toBeDefined();

    const emptyMessage = await request(app.getHttpServer())
      .post("/api/v1/kudos")
      .set("Cookie", cookie)
      .send({ recipient: recipient.email, message: "" });
    expect(emptyMessage.status).toBe(400);
    expect(emptyMessage.body.message).toBeDefined();

    // Neither invalid payload created anything.
    expect(await prisma.kudos.count({ where: { authorId: author.id } })).toBe(0);
  });

  it("[AC-10] after kudos A is posted and then B, GET lists B before A", async () => {
    const author = await createMember("author-ac10");
    const recipient = await createMember("recipient-ac10");
    const cookie = await sessionCookieFor(author);

    const first = await request(app.getHttpServer())
      .post("/api/v1/kudos")
      .set("Cookie", cookie)
      .send({ recipient: recipient.email, message: "kudos A" });
    expect(first.status).toBe(201);

    // A small, real gap so the two `createdAt` values differ.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const second = await request(app.getHttpServer())
      .post("/api/v1/kudos")
      .set("Cookie", cookie)
      .send({ recipient: recipient.email, message: "kudos B" });
    expect(second.status).toBe(201);

    const board = await request(app.getHttpServer())
      .get("/api/v1/kudos")
      .set("Cookie", cookie);

    expect(board.status).toBe(200);
    const items: { id: string; message: string }[] = board.body.items;
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(2);

    // Newest first: B appears before A.
    expect(items.map((item) => item.message)).toEqual(["kudos B", "kudos A"]);
  });

  it("[AC-11] with 25 visible kudos page 1 returns the 20 newest and page 2 the remaining 5", async () => {
    const author = await createMember("author-ac11");
    const recipient = await createMember("recipient-ac11");
    const cookie = await sessionCookieFor(author);

    // 25 kudos with strictly increasing, well-separated timestamps so the
    // intended order is unambiguous even at millisecond resolution.
    const base = Date.now() - 60 * 60 * 1000;
    const seeded: SeededKudos[] = [];
    for (let index = 0; index < 25; index += 1) {
      // index 0 is the oldest, index 24 the newest.
      seeded.push(
        await seedKudos(
          author.id,
          recipient.id,
          `kudos #${index}`,
          new Date(base + index * 1000),
        ),
      );
    }
    // Expected newest-first order: index 24 down to 0.
    const expectedIds = [...seeded].reverse().map((row) => row.id);

    const page1 = await request(app.getHttpServer())
      .get("/api/v1/kudos")
      .set("Cookie", cookie);
    expect(page1.status).toBe(200);

    const page1Items: { id: string }[] = page1.body.items;
    expect(page1Items).toHaveLength(KUDOS_PAGE_SIZE);
    expect(page1.body.pageSize).toBe(KUDOS_PAGE_SIZE);
    expect(page1.body.page).toBe(1);

    const page2 = await request(app.getHttpServer())
      .get("/api/v1/kudos?page=2")
      .set("Cookie", cookie);
    expect(page2.status).toBe(200);

    const page2Items: { id: string }[] = page2.body.items;
    expect(page2Items).toHaveLength(5);
    expect(page2.body.page).toBe(2);

    const page1Ids = page1Items.map((item) => item.id);
    const page2Ids = page2Items.map((item) => item.id);

    // Page 1 is exactly the 20 newest, in the ADR-6 stable order.
    expect(page1Ids).toEqual(expectedIds.slice(0, 20));
    // Page 2 is the remaining 5, continuing the same order.
    expect(page2Ids).toEqual(expectedIds.slice(20));

    // No kudos is duplicated or omitted across the two pages.
    const allIds = [...page1Ids, ...page2Ids];
    expect(allIds).toHaveLength(25);
    expect(new Set(allIds).size).toBe(25);
    expect([...new Set(allIds)].sort()).toEqual(
      seeded.map((row) => row.id).sort(),
    );
  });

  it("GET /api/v1/kudos lists only visible kudos and hides soft-hidden ones", async () => {
    const author = await createMember("author-hidden");
    const recipient = await createMember("recipient-hidden");
    const cookie = await sessionCookieFor(author);
    const base = Date.now() - 60 * 1000;

    const visible = [
      await seedKudos(author.id, recipient.id, "visible #1", new Date(base)),
      await seedKudos(
        author.id,
        recipient.id,
        "visible #2",
        new Date(base + 1000),
      ),
    ];
    // A soft-hidden row (ADR-5): retained, but off the board for everyone.
    const hidden = await seedKudos(
      author.id,
      recipient.id,
      "hidden one",
      new Date(base + 2000),
      new Date(base + 3000),
    );

    const board = await request(app.getHttpServer())
      .get("/api/v1/kudos")
      .set("Cookie", cookie);

    expect(board.status).toBe(200);
    const items: { id: string }[] = board.body.items;
    expect(items).toHaveLength(2);
    // Newest first, and the soft-hidden row is absent even though it is newest.
    expect(items.map((item) => item.id)).toEqual([
      visible[1].id,
      visible[0].id,
    ]);
    expect(items.map((item) => item.id)).not.toContain(hidden.id);

    // The total counts only visible rows.
    expect(board.body.total).toBe(2);
  });

  it("GET /api/v1/kudos?hidden=true reviews soft-hidden kudos for a lead and answers 403 for a member", async () => {
    const lead = await createMember("lead-review", "LEAD");
    const member = await createMember("member-review", "MEMBER");
    const author = await createMember("author-review");
    const recipient = await createMember("recipient-review");
    const leadCookie = await sessionCookieFor(lead);
    const memberCookie = await sessionCookieFor(member);
    const base = Date.now() - 60 * 1000;

    const hiddenAt = new Date(base + 5000);
    const hidden = await seedKudos(
      author.id,
      recipient.id,
      "soft-hidden review item",
      new Date(base + 4000),
      hiddenAt,
    );
    await seedKudos(author.id, recipient.id, "still visible", new Date(base));

    // A regular MEMBER is authenticated but not privileged: 403, not 401.
    const forbidden = await request(app.getHttpServer())
      .get("/api/v1/kudos?hidden=true")
      .set("Cookie", memberCookie);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.statusCode).toBe(403);

    // A lead sees the soft-hidden kudos in the standard shape plus the audit
    // fields - and only those, never the visible ones.
    const review = await request(app.getHttpServer())
      .get("/api/v1/kudos?hidden=true")
      .set("Cookie", leadCookie);
    expect(review.status).toBe(200);

    const reviewItems: { id: string; message: string; hiddenAt: string }[] =
      review.body.items;
    expect(reviewItems).toHaveLength(1);
    expect(reviewItems[0].id).toBe(hidden.id);
    expect(reviewItems[0].message).toBe("soft-hidden review item");
    expect(reviewItems[0].hiddenAt).toBe(hiddenAt.toISOString());

    // The standard ADR-7 fields are all present on the review item too.
    const single = reviewItems[0] as Record<string, unknown>;
    expect(typeof single.recipient).toBe("string");
    expect(typeof single.message).toBe("string");
    expect(typeof single.createdAt).toBe("string");
    expect(Array.isArray(single.reactions)).toBe(true);
    expect(typeof single.hiddenBy).toBe("object");
  });
});
