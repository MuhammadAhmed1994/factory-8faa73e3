import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Idempotent schema bootstrap for the API's e2e specs.
 *
 * ## Why this exists
 *
 * The repo's migrations (`prisma/migrations/*.sql`) are the single source of
 * truth for the schema, but nothing in the workspace applies them — the root
 * `package.json` only offers `db:up`, which starts an *empty* postgres
 * container. A spec that assumes an already-migrated database therefore fails
 * with `The table "public.kudos" does not exist` on any fresh checkout.
 *
 * Rather than each spec re-declaring the DDL (which would drift from
 * `schema.prisma`), this helper applies the real migration files once, when the
 * `kudos` table is missing, and leaves an already-migrated database untouched.
 *
 * ## Relationship to `prisma migrate`
 *
 * Applied migrations are recorded in `_prisma_migrations` with the file's
 * sha256 checksum, so a later `prisma migrate deploy` recognises them as
 * applied instead of failing on "table already exists". That bookkeeping is
 * best-effort: if it cannot be written, the tables still exist and the specs
 * still run.
 */

/** A table row in Prisma's migration bookkeeping table. */
interface MigrationRow {
  readonly migration_name: string;
  readonly checksum: string;
}

/** The slice of a Prisma client this helper needs. */
interface RawExecutor {
  $queryRawUnsafe(query: string): Promise<unknown>;
  $executeRawUnsafe(query: string): Promise<number>;
}

/** Reads `to_regclass`, which yields `null` for a missing relation. */
const relationExists = async (
  prisma: RawExecutor,
  name: string,
): Promise<boolean> => {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT to_regclass('${name}')::text AS reg`,
  )) as { reg: string | null }[];
  return rows.length > 0 && rows[0].reg !== null;
};

/** The migration directory, resolved from this file so cwd never matters. */
const migrationsDir = (): string => join(__dirname, "..", "prisma", "migrations");

/**
 * Splits a `.sql` file into executable statements.
 *
 * `--` line comments are stripped first; the migrations in this repo contain no
 * string literals, so splitting the remainder on `;` is exact.
 */
const statementsOf = (sql: string): string[] =>
  sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

/** sha256 of a migration file, matching Prisma's `_prisma_migrations.checksum`. */
const checksumOf = (contents: string): string =>
  createHash("sha256").update(contents, "utf8").digest("hex");

/** Every migration directory that holds a `migration.sql`, sorted by name. */
const migrationFiles = (): { name: string; path: string; sql: string }[] => {
  const dir = migrationsDir();

  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((entry) => existsSync(join(dir, entry, "migration.sql")))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => {
      const path = join(dir, entry, "migration.sql");
      return { name: entry, path, sql: readFileSync(path, "utf8") };
    });
};

/** Reads the migrations already recorded in `_prisma_migrations`, if any. */
const appliedMigrations = async (
  prisma: RawExecutor,
): Promise<Set<string>> => {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT migration_name, checksum FROM _prisma_migrations WHERE rolled_back_at IS NULL",
    )) as MigrationRow[];
    return new Set(rows.map((row) => row.migration_name));
  } catch {
    // No bookkeeping table yet: nothing has been applied.
    return new Set<string>();
  }
};

/** Records one migration as applied, best-effort. */
const recordMigration = async (
  prisma: RawExecutor,
  name: string,
  checksum: string,
): Promise<void> => {
  try {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
         "id" TEXT NOT NULL,
         "checksum" TEXT NOT NULL,
         "finished_at" TIMESTAMPTZ,
         "migration_name" TEXT NOT NULL,
         "logs" TEXT,
         "rolled_back_at" TIMESTAMPTZ,
         "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
         "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
         CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
       )`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations"
         ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
       VALUES
         (gen_random_uuid()::text, '${checksum}', now(), '${name}', 1)`,
    );
  } catch {
    // Bookkeeping is optional; the schema itself is what the specs need.
  }
};

/**
 * Ensures the database schema exists.
 *
 * Cheap when the database is already migrated (one `to_regclass` probe), and
 * otherwise applies every outstanding migration file in order. Safe to call
 * from each spec's `beforeAll`.
 */
export const ensureSchema = async (
  prisma: RawExecutor,
): Promise<{ applied: string[]; skipped: boolean }> => {
  if (await relationExists(prisma, "public.kudos")) {
    return { applied: [], skipped: true };
  }

  const applied = await appliedMigrations(prisma);
  const appliedNow: string[] = [];

  for (const migration of migrationFiles()) {
    if (applied.has(migration.name)) {
      continue;
    }

    for (const statement of statementsOf(migration.sql)) {
      await prisma.$executeRawUnsafe(statement);
    }

    await recordMigration(prisma, migration.name, checksumOf(migration.sql));
    appliedNow.push(migration.name);
  }

  return { applied: appliedNow, skipped: false };
};
