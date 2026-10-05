/**
 * Prisma seed script: the fixed member roster with known passwords (T-4 / ADR-2 / Q-2 / Q-5).
 *
 * Run by `prisma db seed` through the `prisma.seed` entry already declared in
 * `apps/api/package.json` (`ts-node prisma/seed.ts`), i.e. with the API package
 * as the working directory, so the relative imports below resolve into `src/`.
 *
 * Contract:
 *   * Deterministic roster - at least two MEMBER accounts and at least one LEAD
 *     account. The LEAD account is what later moderation e2e specs drive to a
 *     2xx hide; the MEMBER accounts are the 403 path (AC-17 / AC-18).
 *   * Credentials come from SEED_* environment variables. Their fallbacks are
 *     not restated here: the roster is built from `loadAppConfig()` itself, so
 *     the seed and the application can never disagree about a safe default.
 *   * Every password is funnelled through the T-3 helper `hashPassword`
 *     (Argon2id, bcrypt cost 12 fallback) before it reaches the database.
 *     Plaintext passwords are never persisted and never logged.
 *   * Rows are written with `upsert` keyed on the unique `Member.email`, so a
 *     re-run converges `role` and `passwordHash` instead of duplicating rows;
 *     a stored hash that still verifies is left byte-for-byte untouched.
 */

import {
  DEFAULT_DATABASE_URL,
  loadAppConfig,
  type AppConfig,
} from "../src/app.config";
import {
  hashAlgorithm,
  hashPassword,
  verifyPassword,
} from "../src/common/security/password.util";

/** Roles a seeded member can hold (mirrors the `MemberRole` Prisma enum). */
export type SeedRole = "MEMBER" | "LEAD";

/** One account of the seed roster. */
export interface SeedMemberAccount {
  readonly email: string;
  readonly role: SeedRole;
  /**
   * Plaintext credential taken from SEED_* / the app config defaults.
   * It exists in memory only, is hashed before any write and must never be
   * logged (ADR-2).
   */
  readonly password: string;
}

/** Log-safe summary of one seeded row - no secret material. */
export interface SeededMember {
  readonly id: string;
  readonly email: string;
  readonly role: SeedRole;
  readonly algorithm: ReturnType<typeof hashAlgorithm>;
}

/**
 * The slice of `PrismaClient` this script needs.
 *
 * Declaring it (instead of importing the generated client) keeps the script
 * type-checkable in a fresh checkout where `prisma generate` has not run yet,
 * mirroring how `PrismaService` resolves its base class.
 */
export interface SeedPrismaClient {
  readonly member: {
    findUnique(args: {
      where: { email: string };
    }): Promise<{ passwordHash: string } | null>;
    upsert(args: {
      where: { email: string };
      create: { email: string; passwordHash: string; role: SeedRole };
      update: { passwordHash?: string; role: SeedRole };
    }): Promise<{
      id: string;
      email: string;
      role: SeedRole;
      passwordHash: string;
    }>;
  };
  $disconnect(): Promise<void>;
}

/** Splits an optional comma-separated SEED_* list into trimmed, non-empty entries. */
function csvList(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * Derives a deterministic sibling address (`member@x` -> `member2@x`) so the
 * default roster always carries the second MEMBER account the later e2e specs
 * need, even when nothing but the app defaults is configured.
 */
function siblingEmailAddress(email: string, suffix: string): string {
  const at = email.lastIndexOf("@");
  return at > 0
    ? `${email.slice(0, at)}${suffix}${email.slice(at)}`
    : `${email}${suffix}`;
}

/** LEAD emails (ADR-2: lead emails are marked with a role at seed time). */
function resolveLeadEmails(config: AppConfig): string[] {
  const listed = csvList(process.env.SEED_LEAD_EMAILS);
  return listed.length > 0 ? listed : [config.seedLead.email];
}

/**
 * MEMBER emails: the configured member account plus a deterministic sibling,
 * unless an explicit list is provided. All of them share the member password.
 */
function resolveMemberEmails(config: AppConfig): string[] {
  const listed = csvList(process.env.SEED_MEMBER_EMAILS);
  if (listed.length > 0) {
    return listed;
  }
  const explicitSecond = process.env.SEED_MEMBER_2_EMAIL?.trim();
  const second =
    explicitSecond !== undefined && explicitSecond !== ""
      ? explicitSecond
      : siblingEmailAddress(config.seedMember.email, "2");
  return [config.seedMember.email, second];
}

/** Guards the roster shape the rest of the task graph depends on. */
function assertRosterInvariants(accounts: readonly SeedMemberAccount[]): void {
  const leads = accounts.filter((account) => account.role === "LEAD").length;
  const members = accounts.filter((account) => account.role === "MEMBER").length;
  if (leads < 1 || members < 2) {
    throw new Error(
      `Seed roster must contain at least one LEAD and two MEMBER accounts (got ${leads} LEAD, ${members} MEMBER). Check SEED_LEAD_EMAILS / SEED_MEMBER_EMAILS.`,
    );
  }
}

/**
 * Builds the deterministic roster from the environment.
 *
 * Members share one password, leads share another (both from SEED_* variables
 * with the `app.config.ts` safe defaults as fallback). An email listed both as
 * lead and as member is seeded exactly once, as LEAD - a lead designation wins
 * over a member listing.
 */
export function buildSeedRoster(): readonly SeedMemberAccount[] {
  const config = loadAppConfig();
  const roster = new Map<string, SeedMemberAccount>();

  const add = (email: string, role: SeedRole, password: string): void => {
    const trimmed = email.trim();
    if (!trimmed.includes("@")) {
      throw new Error(
        `Refusing to seed "${trimmed}": not a valid email (expected name@domain).`,
      );
    }
    if (typeof password !== "string" || password === "") {
      throw new Error(
        `Refusing to seed "${trimmed}" with an empty password. Check the SEED_*_PASSWORD variables.`,
      );
    }
    const key = trimmed.toLowerCase();
    const existing = roster.get(key);
    if (
      existing === undefined ||
      (existing.role === "MEMBER" && role === "LEAD")
    ) {
      roster.set(key, { email: trimmed, role, password });
    }
  };

  for (const email of resolveLeadEmails(config)) {
    add(email, "LEAD", config.seedLead.password);
  }
  for (const email of resolveMemberEmails(config)) {
    add(email, "MEMBER", config.seedMember.password);
  }

  const accounts = [...roster.values()];
  assertRosterInvariants(accounts);
  return accounts;
}

/**
 * Upserts the roster into the `Member` table, keyed on the unique `email`.
 *
 * Convergence on re-runs: `role` is always re-asserted, and `passwordHash` is
 * rewritten only when the stored hash no longer verifies against the seeded
 * password - so a second run leaves an already-correct row untouched.
 */
export async function seedMembers(
  db: SeedPrismaClient,
  roster: readonly SeedMemberAccount[] = buildSeedRoster(),
): Promise<readonly SeededMember[]> {
  const seeded: SeededMember[] = [];

  for (const account of roster) {
    // T-3 funnel: Argon2id (bcrypt cost 12 fallback); the plaintext never
    // leaves this loop and is never written anywhere but into the hash.
    const passwordHash = await hashPassword(account.password);

    const existing = await db.member.findUnique({
      where: { email: account.email },
    });
    const storedHashStillVerifies =
      existing !== null &&
      (await verifyPassword(account.password, existing.passwordHash).catch(
        () => false,
      ));

    const member = await db.member.upsert({
      where: { email: account.email },
      create: { email: account.email, passwordHash, role: account.role },
      update: storedHashStillVerifies
        ? { role: account.role }
        : { role: account.role, passwordHash },
    });

    seeded.push({
      id: member.id,
      email: member.email,
      role: member.role,
      algorithm: hashAlgorithm(member.passwordHash),
    });
  }

  return seeded;
}

/** Resolves the generated `PrismaClient` constructor, or throws with the fix. */
function resolveSeedClientCtor(): new () => SeedPrismaClient {
  let prismaClientModule: { PrismaClient?: unknown };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    prismaClientModule = require("@prisma/client") as {
      PrismaClient?: unknown;
    };
  } catch {
    throw new Error(
      "The @prisma/client package could not be loaded. Run `pnpm --filter api exec prisma generate` first.",
    );
  }

  const ctor = prismaClientModule?.PrismaClient;
  if (typeof ctor !== "function") {
    throw new Error(
      "PrismaClient has not been generated yet. Run `pnpm --filter api exec prisma generate` first.",
    );
  }
  return ctor as new () => SeedPrismaClient;
}

/**
 * Entry point used by `prisma db seed`: builds the roster, upserts it and
 * reports emails, roles and hash algorithms only - never a password.
 */
export async function runSeed(): Promise<readonly SeededMember[]> {
  // Same default as `src/app.config.ts` / `test/setup-e2e.ts`; a real
  // DATABASE_URL always wins and no `.env` file is read.
  process.env.DATABASE_URL ??= DEFAULT_DATABASE_URL;

  const db = new (resolveSeedClientCtor())();
  try {
    const seeded = await seedMembers(db);
    for (const member of seeded) {
      console.log(
        `seeded member ${member.email} (role=${member.role}, passwordHash=${member.algorithm})`,
      );
    }
    return seeded;
  } finally {
    await db.$disconnect();
  }
}

// Execute only when run directly (`ts-node prisma/seed.ts`); importing the
// module - e.g. from a spec - has no side effects.
if (require.main === module) {
  void runSeed()
    .then((seeded) => {
      console.log(`Seed complete: ${seeded.length} member account(s) upserted.`);
    })
    .catch((error: unknown) => {
      console.error(
        `Seed failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}
