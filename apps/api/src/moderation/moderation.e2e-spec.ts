import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { Test } from "@nestjs/testing";
import {
  HttpStatus,
  ValidationPipe,
  type INestApplication,
} from "@nestjs/common";
import { loadAppConfig, type AppConfig } from "../app.config";
import { KudosModule } from "../kudos/kudos.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { seedMembers } from "../../prisma/seed";
import { ModerationModule } from "./moderation.module";

/**
 * Moderation e2e spec (T-8 / EP-6 / ADR-5 / ADR-7).
 *
 * Exactly one `it()` block per acceptance criterion, titled with only its AC id
 * so the Eval stage attributes evidence to precisely that criterion:
 *   * `[AC-17]` - a lead hiding a kudos gets 2xx and the kudos afterwards is
 *     absent from `GET /api/v1/kudos` for **every** member account.
 *   * `[AC-18]` - a regular member gets 403 and the kudos stays on the board.
 *
 * Mounting follows the repo's e2e pattern: the feature module under test plus
 * the Prisma/session/roles guard foundation. `KudosModule` is mounted too
 * because both criteria are stated in terms of the board read (EP-3) - the
 * hide is only meaningful once it changes what the board returns.
 *
 * Actors are the **real T-4 seeded accounts** (the known LEAD and the MEMBER
 * roster), converged with the seed script's idempotent upserts. Sessions are
 * created as server-side `Session` rows - exactly what `POST /auth/login`
 * issues (ADR-1) - so the auth module need not be a dependency here.
 *
 * Everything this spec writes is removed again in `afterAll`, scoped to the
 * rows it created (never `deleteMany({})`), so the seeded roster and any
 * concurrently running spec's fixtures are left untouched.
 */

/** Typed config: cookie name and the seeded credentials come from here. */
const CONFIG: AppConfig = loadAppConfig();

/** Cookie name the session guard reads (ADR-1). */
const SESSION_COOKIE = CONFIG.sessionCookieName;

/** Unique-per-run prefix so this spec's kudos messages can never collide. */
const RUN = `t8-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A seeded account as this spec uses it. */
interface SeededAccount {
  readonly id: string;
  readonly email: string;
  readonly role: "MEMBER" | "LEAD";
}

/** A kudos fixture this spec created (and will remove again). */
interface KudosFixture {
  readonly id: string;
  readonly message: string;
}

/** The roster the T-4 seed guarantees: >=1 LEAD and >=2 MEMBER accounts. */
interface Roster {
  readonly lead: SeededAccount;
  readonly members: readonly SeededAccount[];
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

/** The tables the moderation and board features touch. */
const REQUIRED_TABLES = ["Member", "Kudos", "Reaction", "Session"];

/** Board page size (C-3 / ADR-6). */
const PAGE_SIZE = 20;

describe("Moderation: POST /api/v1/kudos/:id/hide (T-8, EP-6)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let roster: Roster;
  /** Every kudos row this spec created, removed again on teardown. */
  const createdKudosIds: string[] = [];
  /** Every session row this spec created, removed again on teardown. */
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // The moderation feature under test plus the board read both criteria are
      // stated against, on top of the Prisma/session/roles guard foundation.
      // Both guards are applied on the controllers themselves, so they resolve
      // from these modules without any explicit provider here.
      imports: [PrismaModule, KudosModule, ModerationModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // The same pipe `main.ts` registers globally, so this module behaves here
    // exactly as it does in production.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
      }),
    );
    await app.init();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    await prisma.$connect();
    await ensureSchema();

    // Converge the T-4 roster (idempotent upserts keyed on the unique email)
    // so the LEAD and MEMBER accounts this spec acts as really exist.
    await seedMembers(prisma);
    roster = await loadRoster();
  });

  afterAll(async () => {
    try {
      await removeFixtures();
    } finally {
      await app.close();
    }
  });

  /**
   * Guarantees the Prisma schema exists before any fixture is written.
   *
   * A freshly started docker-compose PostgreSQL has no tables until
   * `prisma migrate deploy` runs, and this spec must be runnable straight from
   * `pnpm --filter api test -- moderation`. When a table is missing the initial
   * migration is applied verbatim - it is the schema's source of truth. An
   * already-migrated database is left untouched.
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

  /** Reads the converged roster back out of the database, split by role. */
  async function loadRoster(): Promise<Roster> {
    const rows = await prisma.member.findMany({
      where: { role: { in: ["MEMBER", "LEAD"] } },
      select: { id: true, email: true, role: true },
      orderBy: { email: "asc" },
    });

    const accounts: SeededAccount[] = rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role === "LEAD" ? "LEAD" : "MEMBER",
    }));

    const lead = accounts.find((account) => account.role === "LEAD");
    const members = accounts.filter((account) => account.role === "MEMBER");

    // The seed script's own invariant; if it does not hold the spec must not
    // silently pass against the wrong roster.
    if (lead === undefined) {
      throw new Error("No LEAD account found in the seeded roster.");
    }
    if (members.length < 1) {
      throw new Error("No MEMBER account found in the seeded roster.");
    }

    return { lead, members };
  }

  /** Removes exactly the rows this spec created, in dependency order. */
  async function removeFixtures(): Promise<void> {
    if (createdSessionIds.length > 0) {
      await prisma.session.deleteMany({
        where: { id: { in: [...createdSessionIds] } },
      });
      createdSessionIds.length = 0;
    }
    // Reactions cascade from their kudos row.
    if (createdKudosIds.length > 0) {
      await prisma.kudos.deleteMany({
        where: { id: { in: [...createdKudosIds] } },
      });
      createdKudosIds.length = 0;
    }
  }

  /**
   * Opens a server-side session for `member` and returns the `Cookie` header
   * that presents it. This is the ADR-1 credential - the exact row
   * `POST /auth/login` creates - so no auth endpoint is needed here.
   */
  async function sessionCookieFor(member: SeededAccount): Promise<string> {
    const session = await prisma.session.create({
      data: {
        id: `sess-${RUN}-${Math.random().toString(36).slice(2, 12)}`,
        memberId: member.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    createdSessionIds.push(session.id);
    return `${SESSION_COOKIE}=${session.id}`;
  }

  /**
   * Inserts one *visible* kudos row (`hiddenAt: null`) authored by a seeded
   * account, so the hide endpoint has something real to act on.
   */
  async function seedVisibleKudos(
    author: SeededAccount,
    recipient: SeededAccount,
    label: string,
  ): Promise<KudosFixture> {
    const message = `${RUN} ${label}`;
    const kudos = await prisma.kudos.create({
      data: {
        authorId: author.id,
        recipientId: recipient.id,
        message,
        createdAt: new Date(),
      },
      select: { id: true, message: true },
    });
    createdKudosIds.push(kudos.id);
    return kudos;
  }

  /**
   * Reads the whole visible board through the real endpoint, paging through
   * every page (ADR-6) so a fixture beyond page 1 is still observed. Returning
   * the ids (rather than a page) keeps the assertions independent of however
   * many rows other specs left behind.
   */
  async function visibleBoardIds(cookie: string): Promise<string[]> {
    const ids: string[] = [];
    let page = 1;

    for (;;) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/kudos?page=${page}`)
        .set("Cookie", cookie);

      expect(response.status).toBe(HttpStatus.OK);

      const items: { id: string }[] = response.body.items;
      expect(Array.isArray(items)).toBe(true);
      ids.push(...items.map((item) => item.id));

      // Stop once every visible row has been seen (or the board ran dry).
      const total: number = response.body.total;
      if (items.length === 0 || ids.length >= total) {
        return ids;
      }
      if (items.length < PAGE_SIZE) {
        return ids;
      }
      page += 1;
    }
  }

  it("[AC-17]", async () => {
    const { lead, members } = roster;
    const author = members[0];
    const recipient = members[1] ?? members[0];

    // The NFR on this route: without a valid session cookie the hide endpoint
    // answers 401, before any role rule is even considered.
    const anonymous = await request(app.getHttpServer())
      .post(`/api/v1/kudos/no-such-kudos/hide`)
      .set("Cookie", `${SESSION_COOKIE}=not-a-real-session`);
    expect(anonymous.status).toBe(HttpStatus.UNAUTHORIZED);

    const target = await seedVisibleKudos(author, recipient, "lead hides this");

    // Before the hide the kudos is on the board.
    const authorCookie = await sessionCookieFor(author);
    expect(await visibleBoardIds(authorCookie)).toContain(target.id);

    // ADR-5: the soft hide retains the row *and its reactions*.
    await prisma.reaction.create({
      data: { kudosId: target.id, memberId: recipient.id, emoji: "TADA" },
    });

    const leadCookie = await sessionCookieFor(lead);
    const hidden = await request(app.getHttpServer())
      .post(`/api/v1/kudos/${target.id}/hide`)
      .set("Cookie", leadCookie);

    // AC-17: the lead gets a 2xx response.
    expect(hidden.status).toBe(HttpStatus.OK);
    expect(hidden.body).toEqual({ id: target.id });

    // ADR-7: the hide response exposes nothing beyond the id - no `hiddenAt`,
    // no `hiddenBy`, none of the fields reserved for the lead review variant.
    expect(Object.keys(hidden.body).sort()).toEqual(["id"]);

    // ADR-5: the row survives with `hiddenAt` set, and the reaction survives.
    const row = await prisma.kudos.findUnique({
      where: { id: target.id },
      select: { id: true, message: true, hiddenAt: true },
    });
    expect(row).not.toBeNull();
    expect(row?.message).toBe(target.message);
    expect(row?.hiddenAt).toBeInstanceOf(Date);
    expect(await prisma.reaction.count({ where: { kudosId: target.id } })).toBe(
      1,
    );

    // The hide is idempotent: repeating it still answers 2xx and does not
    // rewrite the original soft-hide timestamp.
    const firstHiddenAt = row?.hiddenAt as Date;
    const repeat = await request(app.getHttpServer())
      .post(`/api/v1/kudos/${target.id}/hide`)
      .set("Cookie", leadCookie);
    expect([HttpStatus.OK, HttpStatus.CREATED]).toContain(repeat.status);
    expect(repeat.body).toEqual({ id: target.id });
    expect(await prisma.kudos.findUnique({ where: { id: target.id } })).toMatchObject(
      { hiddenAt: firstHiddenAt },
    );

    // An unknown kudos id answers 404, not a silent success.
    const unknown = await request(app.getHttpServer())
      .post(`/api/v1/kudos/${RUN}-does-not-exist/hide`)
      .set("Cookie", leadCookie);
    expect(unknown.status).toBe(HttpStatus.NOT_FOUND);

    // AC-17 proper: the kudos is now absent from the board for *every* member
    // account - and for the lead, since a hide removes it for everyone.
    const boardCookies = await Promise.all(
      [...members, lead].map((member) => sessionCookieFor(member)),
    );
    for (const cookie of boardCookies) {
      const ids = await visibleBoardIds(cookie);
      expect(ids).not.toContain(target.id);
    }
  });

  it("[AC-18]", async () => {
    const { lead, members } = roster;
    const member = members[0];
    const author = members[1] ?? members[0];
    const recipient = members[0];
    const memberCookie = await sessionCookieFor(member);

    const target = await seedVisibleKudos(
      author,
      recipient,
      "member must not hide this",
    );

    // Sanity: the kudos is on the board before the forbidden call.
    expect(await visibleBoardIds(memberCookie)).toContain(target.id);

    // A signed-in regular MEMBER is authenticated but not privileged: 403,
    // never 401 (which stays reserved for "no session at all").
    const forbidden = await request(app.getHttpServer())
      .post(`/api/v1/kudos/${target.id}/hide`)
      .set("Cookie", memberCookie);
    expect(forbidden.status).toBe(HttpStatus.FORBIDDEN);
    expect(forbidden.body.statusCode).toBe(HttpStatus.FORBIDDEN);

    // The rejection really did nothing: the row is still visible.
    const row = await prisma.kudos.findUnique({
      where: { id: target.id },
      select: { hiddenAt: true },
    });
    expect(row?.hiddenAt).toBeNull();

    // AC-18 proper: the kudos remains present on the board - for the member
    // who was refused and for every other account alike.
    expect(await visibleBoardIds(memberCookie)).toContain(target.id);
    for (const other of members.slice(1)) {
      expect(await visibleBoardIds(await sessionCookieFor(other))).toContain(
        target.id,
      );
    }
    expect(
      await visibleBoardIds(await sessionCookieFor(lead)),
    ).toContain(target.id);
  });
});
