/**
 * Prisma seed for the Team Kudos Board API — ADR-2 / Q-2 / Q-5.
 *
 * Executed by `prisma db seed` through the `prisma.seed` entry already declared
 * in `apps/api/package.json` (`ts-node prisma/seed.ts`). Prisma runs it with
 * `DATABASE_URL` taken from the environment — the same single source the
 * application itself uses via `src/app.config.ts`.
 *
 * ## Roster (fixed and deterministic)
 *
 * | email          | role   | password               |
 * |----------------|--------|------------------------|
 * | maya@team.co   | MEMBER | shared member password |
 * | priya@team.co  | MEMBER | shared member password |
 * | lead@team.co   | LEAD   | shared lead password   |
 *
 * The two MEMBER accounts are what the e2e suites drive through the 403 path of
 * the moderation endpoint, and the LEAD account through its 2xx path
 * (AC-17/AC-18). Any account additionally declared in `appConfig().seedAccounts`
 * is appended, so the seeded table can never drift from the safe defaults the
 * application itself advertises (T-1/T-2).
 *
 * Every email and both shared passwords are overridable through `SEED_*` env
 * vars; the fallbacks are the safe defaults of `src/app.config.ts`.
 *
 * ## Guarantees
 *
 * * **Hashed passwords only.** Each password is passed through the T-3 util
 *   `hashPassword` (Argon2id, with a salted adaptive scrypt fallback) *before*
 *   it reaches the database, and the result is round-trip checked with
 *   `verifyPassword`. A plaintext password is never persisted, never logged and
 *   never echoed — the log lines below carry email, role and hash format only.
 * * **Idempotent.** Every row is written with `upsert` keyed on the unique
 *   `email`, so re-running converges `role` and `passwordHash` in place instead
 *   of duplicating members.
 */

// The seed runs outside the Nest container, so — unlike feature services, which
// inject `PrismaService` — it owns one short-lived client. The `@ts-ignore`
// mirrors `src/prisma/prisma.service.ts`: the `@prisma/client` types only exist
// once `prisma generate` has run, and the structural cast below keeps this
// script type-safe in both states.
// @ts-ignore
import { PrismaClient } from "@prisma/client";

import { appConfig, type SeedAccount } from "../src/app.config";
import {
  hashPassword,
  verifyPassword,
} from "../src/common/security/password.util";

/** The two `MemberRole` enum values of `prisma/schema.prisma`. */
type SeedRole = "MEMBER" | "LEAD";

/** One member the seed writes, with its still-plaintext password. */
interface SeededMember {
  readonly email: string;
  readonly password: string;
  readonly role: SeedRole;
}

/**
 * The slice of the generated `PrismaClient` this script needs, declared
 * structurally so the seed type-checks before `prisma generate` has produced
 * the client (same approach as `src/prisma/prisma.service.ts`).
 */
interface SeedMemberDelegate {
  upsert(args: {
    where: { email: string };
    update: { role: SeedRole; passwordHash: string };
    create: { email: string; role: SeedRole; passwordHash: string };
  }): Promise<{ id: string; email: string; role: SeedRole }>;
  count(): Promise<number>;
}

interface SeedPrismaClient {
  readonly member: SeedMemberDelegate;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
}

/** A configured env value, or `undefined` when unset or blank. */
const readEnv = (key: string): string | undefined => {
  const raw = process.env[key];
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim();
  return value.length === 0 ? undefined : value;
};

/**
 * Reads a comma-separated, order-preserving list of emails, normalised to
 * lower case so the unique `email` key is stable regardless of the casing an
 * operator types.
 */
const readEmailList = (key: string): string[] | undefined => {
  const raw = readEnv(key);
  if (raw === undefined) {
    return undefined;
  }
  const emails = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return emails.length === 0 ? undefined : emails;
};

/**
 * The deterministic default roster (Q-2 seeded lead email, Q-5 seeded accounts
 * only — there is no self-signup, so no other member can ever exist).
 */
const DEFAULT_MEMBER_EMAILS: readonly string[] = [
  "maya@team.co",
  "priya@team.co",
];
const DEFAULT_LEAD_EMAILS: readonly string[] = ["lead@team.co"];

/** Safe defaults from `src/app.config.ts`, resolved once at seed start. */
const CONFIGURED_ACCOUNTS: readonly SeedAccount[] = appConfig().seedAccounts;

/**
 * Shared passwords — one for every MEMBER account, one for every LEAD account —
 * defaulting to the passwords already declared in `src/app.config.ts`.
 */
const CONFIGURED_MEMBER_PASSWORD = CONFIGURED_ACCOUNTS.find(
  (account) => account.role === "MEMBER",
)?.password;
const CONFIGURED_LEAD_PASSWORD = CONFIGURED_ACCOUNTS.find(
  (account) => account.role === "LEAD",
)?.password;
const DEFAULT_MEMBER_PASSWORD =
  CONFIGURED_MEMBER_PASSWORD ?? "kudos-member-pass";
const DEFAULT_LEAD_PASSWORD = CONFIGURED_LEAD_PASSWORD ?? "kudos-lead-pass";

/**
 * Builds the roster to upsert.
 *
 * Precedence: `SEED_*` env vars first, then the deterministic default emails
 * (with the app-config passwords), then any `appConfig().seedAccounts` entry
 * whose email is not already covered. Duplicates by email are collapsed so the
 * unique index on `Member.email` is never challenged.
 */
const buildRoster = (): SeededMember[] => {
  const memberEmails =
    readEmailList("SEED_MEMBER_EMAILS") ?? DEFAULT_MEMBER_EMAILS;
  const leadEmails = [
    ...(readEmailList("SEED_LEAD_EMAILS") ?? DEFAULT_LEAD_EMAILS),
    ...(readEmailList("SEED_LEAD_EMAIL") ?? []),
  ];
  const memberPassword =
    readEnv("SEED_MEMBER_PASSWORD") ?? DEFAULT_MEMBER_PASSWORD;
  const leadPassword = readEnv("SEED_LEAD_PASSWORD") ?? DEFAULT_LEAD_PASSWORD;

  const roster: SeededMember[] = [];
  const seen = new Set<string>();
  const add = (email: string, password: string, role: SeedRole): void => {
    const key = email.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) {
      return;
    }
    seen.add(key);
    roster.push({ email: key, password, role });
  };

  for (const email of memberEmails) {
    add(email, memberPassword, "MEMBER");
  }
  for (const email of leadEmails) {
    add(email, leadPassword, "LEAD");
  }
  for (const account of CONFIGURED_ACCOUNTS) {
    add(
      account.email,
      account.password,
      account.role === "LEAD" ? "LEAD" : "MEMBER",
    );
  }

  return roster;
};

/** Non-secret description of a stored hash's algorithm, for the log line. */
const hashFormat = (hash: string): string => {
  if (hash.startsWith("$argon2id$")) {
    return "argon2id";
  }
  if (hash.startsWith("$argon2")) {
    return "argon2";
  }
  if (hash.startsWith("scrypt$")) {
    return "scrypt";
  }
  return "salted-adaptive-hash";
};

/**
 * Hashes and upserts every roster entry.
 *
 * The write is keyed on the unique `email`, so a re-run updates `role` and
 * `passwordHash` of the existing row rather than inserting a second one —
 * converging on the roster above instead of accumulating duplicates.
 */
const seedMembers = async (
  prisma: SeedPrismaClient,
  roster: readonly SeededMember[],
): Promise<void> => {
  for (const { email, password, role } of roster) {
    const passwordHash = await hashPassword(password);

    // A plaintext password must never reach `Member.passwordHash`: refuse to
    // write a hash that is empty or is the submitted value itself. (Substring
    // matching is deliberately *not* used — a base64 hash of any short
    // password naturally contains that password's characters, so a substring
    // assertion would reject legitimate hashes.)
    if (passwordHash.length === 0 || passwordHash === password) {
      throw new Error(`hashPassword did not produce a hash for ${email}`);
    }
    if (!(await verifyPassword(password, passwordHash))) {
      throw new Error(`hashed password for ${email} failed verification`);
    }

    await prisma.member.upsert({
      where: { email },
      update: { role, passwordHash },
      create: { email, role, passwordHash },
    });

    // Email, role and hash format only — never the password or its hash.
    console.log(
      `[seed] upserted ${email} as ${role} (${hashFormat(passwordHash)})`,
    );
  }
};

const createPrismaClient = (): SeedPrismaClient =>
  // `PrismaClient` reads DATABASE_URL from the environment exactly like
  // `PrismaService` does at runtime.
  new PrismaClient() as unknown as SeedPrismaClient;

const main = async (): Promise<void> => {
  const prisma = createPrismaClient();
  const roster = buildRoster();

  try {
    await prisma.$connect();
    await seedMembers(prisma, roster);

    const total = await prisma.member.count();
    if (total < roster.length) {
      throw new Error(
        `expected at least ${roster.length} members after seeding, found ${total}`,
      );
    }
    console.log(
      `[seed] ${roster.length} account(s) converged; Member table holds ${total} row(s).`,
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
};

// `process.exitCode` (rather than `process.exit`) lets the pool drain before
// the process leaves, and keeps the failure visible to `prisma db seed`.
void main().catch((error: unknown) => {
  console.error(
    `[seed] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
