/**
 * Password hashing helpers (ADR-2).
 *
 * Plaintext passwords exist **only** inside `hashPassword` and `verifyPassword`
 * - these two functions are the single funnel. Nothing here logs, caches or
 * returns a plaintext value, and the encoded hash is the only thing any caller
 * may persist.
 *
 * Primary algorithm is **Argon2id** (salted, adaptive). **bcrypt at cost 12** is
 * the accepted fallback for runtimes where the native `argon2` binding is
 * unavailable (ADR-2 permits bcrypt at cost >= 12). The algorithm is chosen
 * once, at hash time; `verifyPassword` detects it from the hash prefix, so
 * existing hashes stay verifiable if a deployment switches runtime.
 */

/** bcrypt work factor; ADR-2 accepts bcrypt only at cost >= 12. */
export const BCRYPT_COST = 12;

/** Prefix of every Argon2 encoded hash (`$argon2d`, `$argon2i`, `$argon2id`). */
const ARGON2_PREFIX = "$argon2";

/** Prefixes emitted by bcrypt across its `$2` revisions. */
const BCRYPT_PREFIXES = ["$2a$", "$2b$", "$2x$", "$2y$"];

/** The slice of the `argon2` module these helpers rely on. */
interface Argon2Module {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}

/** The slice of the `bcrypt` module these helpers rely on. */
interface BcryptModule {
  hash(plain: string, cost: number): Promise<string>;
  compare(plain: string, hash: string): Promise<boolean>;
}

/**
 * Resolves an optional native dependency at module load, or `null`.
 *
 * `require` (rather than a static import) mirrors `PrismaService`: a static
 * import would put an optional native binding on the compile-time surface and
 * break the build of every feature module that transitively imports this file.
 */
function optionalRequire(moduleId: string): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(moduleId);
  } catch {
    return null;
  }
}

const argon2 = optionalRequire("argon2") as Argon2Module | null;
const bcrypt = optionalRequire("bcrypt") as BcryptModule | null;

/**
 * Hashes a plaintext password with Argon2id, falling back to bcrypt cost 12.
 *
 * The salt is generated inside the algorithm - never supplied, reused or stored
 * separately. Argon2id is `argon2`'s default type, so its default parameters are
 * exactly what ADR-2 asks for and there is nothing to misconfigure here.
 */
export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain === "") {
    throw new TypeError("hashPassword expects a non-empty password string.");
  }

  if (argon2 !== null) {
    // Argon2id, fresh random salt; the plaintext never leaves this call.
    return argon2.hash(plain);
  }

  if (bcrypt !== null) {
    return bcrypt.hash(plain, BCRYPT_COST);
  }

  throw new Error(
    "No supported password hashing module is installed. Add the `argon2` dependency (preferred) or `bcrypt` at cost >= 12.",
  );
}

/**
 * Checks a plaintext password against a stored hash.
 *
 * Resolves `false` for a wrong password. It throws only when the stored hash
 * needs a module that is not installed - a deployment problem that must not
 * masquerade as a bad credential.
 */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (typeof plain !== "string" || typeof hash !== "string" || hash === "") {
    return false;
  }

  if (hash.startsWith(ARGON2_PREFIX)) {
    if (argon2 === null) {
      throw new Error(
        "Stored password hash is Argon2 but the `argon2` module is not installed; cannot verify.",
      );
    }
    return argon2.verify(hash, plain);
  }

  if (BCRYPT_PREFIXES.some((prefix) => hash.startsWith(prefix))) {
    if (bcrypt === null) {
      throw new Error(
        "Stored password hash is bcrypt but the `bcrypt` module is not installed; cannot verify.",
      );
    }
    return bcrypt.compare(plain, hash);
  }

  // Unknown format: never accept, and never throw either - an unrecognisable
  // credential simply does not verify.
  return false;
}

/**
 * Reports the algorithm a stored hash was produced with. Useful to the seed
 * script and to tests, and a reminder that the format is an implementation
 * detail callers must not pattern-match on themselves.
 */
export function hashAlgorithm(
  hash: string,
): "argon2id" | "argon2" | "bcrypt" | "unknown" {
  if (hash.startsWith("$argon2id")) {
    return "argon2id";
  }
  if (hash.startsWith(ARGON2_PREFIX)) {
    return "argon2";
  }
  if (BCRYPT_PREFIXES.some((prefix) => hash.startsWith(prefix))) {
    return "bcrypt";
  }
  return "unknown";
}
