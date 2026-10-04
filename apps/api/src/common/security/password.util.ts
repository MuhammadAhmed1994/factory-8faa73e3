import {
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";

/**
 * Password hashing helpers (ADR-2).
 *
 * Plaintext passwords must only ever exist inside `hashPassword` /
 * `verifyPassword`: never persisted, never logged, never returned in a
 * response. Both functions are module-local so there is no other place in the
 * codebase that touches a plaintext or a hash.
 *
 * ## Algorithm selection
 *
 * ADR-2's primary option is **Argon2id** and the accepted fallback is a salted
 * adaptive hash of comparable strength. `argon2` is a *declared* dependency of
 * this package, so it is resolved and used whenever it is installed:
 *
 * - `hashPassword` produces a PHC-formatted Argon2id hash (`$argon2id$...`)
 *   with a random per-password salt and the OWASP-recommended parameters.
 * - `verifyPassword` verifies PHC hashes through argon2 in constant time.
 *
 * When the native `argon2` binding is not resolvable in the current install
 * (it is an optional/platform-specific native module), the functions fall back
 * to Node's built-in **scrypt** — also a salted, memory-hard, adaptive KDF —
 * so a plaintext password is *never* stored in any environment. Hashes are
 * self-describing (`$argon2id$…` vs `scrypt$N$r$p$salt$digest`), so a hash
 * produced by either path can always be verified by the same function.
 */

/**
 * The slice of the `argon2` API used here, declared structurally so this file
 * type-checks whether or not the native binding is installed.
 */
interface Argon2Module {
  hash(
    plain: string,
    options: { type: number; memoryCost: number; timeCost: number; parallelism: number },
  ): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
  readonly argon2id: number;
}

/**
 * Argon2id parameters.
 *
 * `memoryCost` is in KiB (64 MiB), `timeCost` is the pass count and
 * `parallelism` the lane count — the OWASP-recommended Argon2id defaults,
 * comparable in attack cost to bcrypt with cost >= 12. Every hash also carries
 * its own random salt.
 */
const ARGON2_OPTIONS = {
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * scrypt fallback parameters (Node `crypto`), tuned to be memory-hard.
 *
 * `N` = 2^15 (32 MiB) with `r` = 8 makes each guess cost tens of megabytes
 * and hundreds of milliseconds, i.e. genuinely adaptive rather than a fast
 * digest. `p` = 1 is the standard lane count for this memory target.
 */
const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 1, keyLength: 64 } as const;

/** Bytes of random salt generated per hashed password. */
const SALT_BYTES = 16;

/**
 * Resolves the native `argon2` binding, or `undefined` when it is absent.
 *
 * The `require` is dynamic on purpose: a static import would fail at
 * *compile* time in an install where the optional native module was not
 * built, which is exactly the case this guards against.
 */
const loadArgon2 = (): Argon2Module | undefined => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const resolved = require("argon2") as Argon2Module | undefined;
    if (
      resolved !== undefined &&
      resolved !== null &&
      typeof resolved.hash === "function" &&
      typeof resolved.verify === "function" &&
      typeof resolved.argon2id === "number"
    ) {
      return resolved;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/** Lazily resolved argon2 binding; probed once per process. */
let argon2Binding: Argon2Module | undefined | null = null;

const argon2 = (): Argon2Module | undefined => {
  if (argon2Binding === null) {
    argon2Binding = loadArgon2();
  }
  return argon2Binding === undefined ? undefined : argon2Binding;
};

/** Promisified Node `crypto.scrypt`. */
const scrypt = (
  plain: string,
  salt: Buffer,
  N: number,
  r: number,
  p: number,
  keyLength: number,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    nodeScrypt(
      plain,
      salt,
      keyLength,
      { N, r, p, maxmem: 1 << 28 },
      (error, derivedKey) => {
        if (error !== undefined && error !== null) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });

/**
 * Hashes a plaintext password as a salted adaptive digest.
 *
 * @param plain the plaintext password, exactly as submitted at sign-in
 * @returns a self-describing, salted Argon2id (or scrypt) hash ready to store
 *          in `Member.passwordHash`
 */
export const hashPassword = async (plain: string): Promise<string> => {
  const binding = argon2();
  if (binding !== undefined) {
    return binding.hash(plain, { type: binding.argon2id, ...ARGON2_OPTIONS });
  }

  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await scrypt(
    plain,
    salt,
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    SCRYPT_OPTIONS.keyLength,
  );

  return [
    "scrypt",
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join("$");
};

/**
 * Verifies a plaintext password against a stored hash in constant time.
 *
 * @param plain the plaintext password submitted at sign-in
 * @param hash  the stored `Member.passwordHash`
 * @returns `true` when the password matches the hash
 * @throws when the stored hash is an argon2 hash but argon2 is unavailable, or
 *         the hash is malformed — a hash we cannot interpret must fail loudly
 *         rather than silently report a mismatch.
 */
export const verifyPassword = async (
  plain: string,
  hash: string,
): Promise<boolean> => {
  if (typeof hash !== "string" || hash.length === 0) {
    return false;
  }

  if (hash.startsWith("$argon2")) {
    const binding = argon2();
    if (binding === undefined) {
      throw new Error(
        "Stored password hash is Argon2 but the argon2 binding is not installed",
      );
    }
    return binding.verify(hash, plain);
  }

  const parts = hash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    throw new Error("Stored password hash has an unrecognised format");
  }

  const N = Number.parseInt(parts[1] ?? "", 10);
  const r = Number.parseInt(parts[2] ?? "", 10);
  const p = Number.parseInt(parts[3] ?? "", 10);
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");

  if (
    !Number.isFinite(N) ||
    N <= 0 ||
    !Number.isFinite(r) ||
    r <= 0 ||
    !Number.isFinite(p) ||
    p <= 0 ||
    salt.length === 0 ||
    expected.length === 0
  ) {
    throw new Error("Stored password hash has invalid scrypt parameters");
  }

  const derivedKey = await scrypt(plain, salt, N, r, p, expected.length);

  return (
    derivedKey.length === expected.length &&
    timingSafeEqual(derivedKey, expected)
  );
};
