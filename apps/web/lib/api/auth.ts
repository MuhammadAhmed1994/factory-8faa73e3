import { ApiError, type MemberRole, type SessionMember } from "@/lib/api-client";

/**
 * Browser-side auth API surface (EP-1 `POST /api/v1/auth/login`, EP-2
 * `GET /api/v1/auth/session` — ADR-1).
 *
 * Both calls go to **same-origin** paths. `next.config.ts` rewrites
 * `/api/v1/*` to the NestJS API, so the browser only ever talks to the Next.js
 * origin: the opaque session cookie the login response sets is therefore a
 * first-party, httpOnly, SameSite=Lax cookie that the browser stores and sends
 * back on every later request — exactly what ADR-1 requires and what the
 * follow-up authenticated `GET /api/v1/kudos` depends on (AC-1). A cross-origin
 * base URL here would put that cookie in third-party-cookie territory and could
 * silently drop the session.
 *
 * Server Components do **not** use this module: they resolve the member from
 * the httpOnly cookie through `lib/session.ts`, which forwards the cookie
 * explicitly to the API's direct origin.
 */

/** Same-origin login path (proxied to the API by the `next.config.ts` rewrite). */
export const AUTH_LOGIN_ENDPOINT = "/api/v1/auth/login";

/** Same-origin session path (EP-2). */
export const AUTH_SESSION_ENDPOINT = "/api/v1/auth/session";

/** Re-exported so callers have one place to read the auth resource types from. */
export type { MemberRole, SessionMember };

/** Credentials POSTed as a JSON body to {@link AUTH_LOGIN_ENDPOINT}. */
export interface LoginCredentials {
  email: string;
  password: string;
}

/** Anything the JSON error body of a non-2xx response may be. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Best-effort single human-readable message out of an API error body. */
function readErrorMessage(status: number, body: unknown): string {
  if (isRecord(body)) {
    const direct = body.message ?? body.error;
    if (typeof direct === "string" && direct.length > 0) {
      return direct;
    }
    if (Array.isArray(body.message)) {
      const parts = body.message.filter(
        (entry): entry is string => typeof entry === "string",
      );
      if (parts.length > 0) {
        return parts.join(", ");
      }
    }
  }
  if (typeof body === "string" && body.trim().length > 0) {
    return body.trim();
  }
  return `Request failed with status ${status}`;
}

/** Options accepted by the internal same-origin JSON fetch. */
interface SameOriginOptions {
  method?: "GET" | "POST";
  /** JSON-serialisable request body; `undefined` sends none. */
  body?: unknown;
}

/**
 * Same-origin JSON request shared by {@link login} and {@link getSession}.
 *
 * - `credentials: "same-origin"` — the httpOnly session cookie the API sets is
 *   stored (first-party) and replayed on the session read.
 * - Any non-2xx response rejects with the shared {@link ApiError}, so callers
 *   branch on `status` (401 invalid credentials, 0 unreachable) exactly as they
 *   do everywhere else in the app.
 * - A network-level failure (API down, offline, blocked) rejects with
 *   `ApiError` status `0` — the sign-in screen's "can't reach the server" case.
 */
async function authFetch<T>(
  endpoint: string,
  options: SameOriginOptions = {},
): Promise<T> {
  const headers = new Headers();
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (cause) {
    throw new ApiError(
      0,
      cause instanceof Error ? cause.message : "Network request failed",
    );
  }

  const raw = await response.text();
  let parsed: unknown = undefined;
  if (raw.trim().length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      readErrorMessage(response.status, parsed),
      parsed,
    );
  }

  return parsed as T;
}

/**
 * `POST /api/v1/auth/login` (EP-1) with JSON credentials.
 *
 * Resolves on **200** with the signed-in member (`{ email, role }`). The API
 * sets the httpOnly session cookie on this response; because the call is
 * same-origin the browser keeps it and sends it with the board fetch that
 * follows the redirect.
 *
 * Rejects with `ApiError` otherwise:
 * - `status 401` — valid shape, wrong email or password (AC-2, no cookie set).
 * - `status 0`   — the API could not be reached at all.
 */
export async function login(
  email: string,
  password: string,
): Promise<SessionMember> {
  return authFetch<SessionMember>(AUTH_LOGIN_ENDPOINT, {
    method: "POST",
    body: { email, password } satisfies LoginCredentials,
  });
}

/**
 * `GET /api/v1/auth/session` (EP-2) → the member the session cookie resolves
 * to, `{ email, role }`.
 *
 * Used by client islands that need the signed-in member after the board has
 * already been server-rendered (e.g. re-reading the role for the lead-only hide
 * control, AC-19). Rejects with `ApiError` 401 when the cookie is missing,
 * unknown or expired.
 */
export async function getSession(): Promise<SessionMember> {
  return authFetch<SessionMember>(AUTH_SESSION_ENDPOINT);
}

export default authFetch;
