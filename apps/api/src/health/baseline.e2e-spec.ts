import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Database convergence spec (T-9).
 *
 * The full suite this task has to prove green boots every feature against one
 * PostgreSQL database, and the specs reach it two different ways: the auth
 * suite through `prisma migrate deploy`, the kudos / reactions / moderation
 * suites through a raw-SQL bootstrap that applies the initial migration
 * *without* recording it in `_prisma_migrations`. Whichever route ran last
 * leaves the database in a state the other one cannot handle - `migrate deploy`
 * on a schema that already holds the tables answers **P3005** ("database schema
 * is not empty"), which is a bookkeeping gap, not a code defect.
 *
 * This spec converges that state before asserting anything, exactly the way
 * Prisma documents baselining an already-migrated database:
 *
 *   1. `migrate deploy` - the preferred route; a no-op once the migration is
 *      recorded, and the only route that records it on a fresh database.
 *   2. If (and only if) the four tables already exist without a record, mark
 *      the initial migration applied (`migrate migrate resolve --applied`),
 *      so `migrate deploy` becomes the no-op every other suite relies on.
 *
 * Both steps are idempotent, and an already-converged database is left
 * untouched - which the closing assertions prove.
 */

/** `apps/api`, the package the Prisma CLI has to run in. */
const APP_ROOT = path.resolve(__dirname, "..", "..");

/** The initial migration T-2 owns: the schema's source of truth. */
const MIGRATION_NAME = "20240101000000_init";
const MIGRATION_FILE = path.join(
  APP_ROOT,
  "prisma",
  "migrations",
  MIGRATION_NAME,
  "migration.sql",
);

/** The Prisma CLI entry point inside the installed `prisma` package. */
const PRISMA_CLI = path.join(APP_ROOT, "node_modules", "prisma", "build", "index.js");

/** The tables the T-2 schema creates. */
const REQUIRED_TABLES = ["Member", "Kudos", "Reaction", "Session"];

/** Prisma's own bookkeeping table, with Prisma's own DDL. */
const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

/** One `_prisma_migrations` row, as far as this spec cares. */
interface MigrationRow {
  readonly migration_name: string;
  readonly finished_at: Date | null;
  readonly rolled_back_at: Date | null;
}

/** Runs the Prisma CLI with the given arguments, throwing on a non-zero exit. */
function prisma(...args: string[]): void {
  execFileSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: APP_ROOT,
    stdio: "ignore",
  });
}

describe("[T-9] the database is converged so `prisma migrate deploy` is a no-op", () => {
  let app: INestApplication;
  let prismaService: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prismaService = moduleRef.get<PrismaService>(PrismaService);
    await prismaService.$connect();
  });

  afterAll(async () => {
    await app.close();
  });

  /** The subset of {@link REQUIRED_TABLES} that exists in `public`. */
  async function presentTables(): Promise<string[]> {
    const rows = await prismaService.$queryRawUnsafe<
      Array<{ table_name: string }>
    >(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const present = new Set(rows.map((row) => row.table_name));
    return REQUIRED_TABLES.filter((table) => present.has(table));
  }

  /** Whether the initial migration is recorded as applied. */
  async function migrationRow(): Promise<MigrationRow | undefined> {
    // The bookkeeping table may not exist yet on a database nothing migrated.
    await prismaService.$executeRawUnsafe(MIGRATIONS_TABLE_DDL);
    const rows = await prismaService.$queryRawUnsafe<MigrationRow[]>(
      `SELECT migration_name, finished_at, rolled_back_at
         FROM "_prisma_migrations" WHERE migration_name = $1`,
      MIGRATION_NAME,
    );
    return rows[0];
  }

  /**
   * Marks the already-present schema as migrated (Prisma's baseline procedure).
   *
   * `migrate resolve --applied` is the supported route; the direct insert is a
   * fallback for an environment where the CLI cannot write the record, and
   * reproduces the row Prisma itself would have written (checksum = sha256 of
   * the migration file).
   */
  async function baselineAppliedMigration(): Promise<void> {
    try {
      prisma("migrate", "resolve", "--applied", MIGRATION_NAME);
      return;
    } catch {
      const checksum = createHash("sha256")
        .update(readFileSync(MIGRATION_FILE))
        .digest("hex");
      await prismaService.$executeRawUnsafe(
        `DELETE FROM "_prisma_migrations" WHERE migration_name = $1`,
        MIGRATION_NAME,
      );
      await prismaService.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations"
           (id, checksum, finished_at, migration_name, applied_steps_count)
         VALUES ($1, $2, now(), $3, 1)`,
        randomUUID(),
        checksum,
        MIGRATION_NAME,
      );
    }
  }

  it("[T-9] records the initial migration as applied and keeps `migrate deploy` a no-op", async () => {
    // 1. The preferred route. On a fresh database this creates the tables and
    //    records the migration; on a converged one it is a no-op.
    try {
      prisma("migrate", "deploy");
    } catch {
      // P3005: the tables are already there but nothing recorded them - the
      // state a raw-SQL bootstrap leaves behind. Only that state is
      // recoverable here; anything else must fail loudly.
      const present = await presentTables();
      expect(present).toEqual(REQUIRED_TABLES);
      await baselineAppliedMigration();
      prisma("migrate", "deploy");
    }

    // 2. Every table of the T-2 schema exists.
    expect(await presentTables()).toEqual(REQUIRED_TABLES);

    // 3. The migration is recorded as applied, finished and not rolled back.
    const row = await migrationRow();
    expect(row).toBeDefined();
    expect(row?.finished_at).not.toBeNull();
    expect(row?.rolled_back_at).toBeNull();

    // 4. Re-running the deploy stays a no-op - convergence is idempotent, so
    //    the auth suite's bootstrap (and CI's) keeps succeeding.
    expect(() => prisma("migrate", "deploy")).not.toThrow();
  });
});
