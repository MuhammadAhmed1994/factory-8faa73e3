/**
 * Auth API client (EP-1 / EP-2, ADR-1).
 *
 * - `login(email, password)` → `POST /api/v1/auth/login` with JSON credentials.
 * - `getSession()` → `GET /api/v1/auth/session`, typed as `{ email, role }`.
 *
 * Both go through `lib/api-client.ts`, which sends `credentials: "include"`, so
 * the opaque session the API writes with `Set-Cookie` (httpOnly, SameSite=Lax,
 * per ADR-1) is stored by the browser and rides along on every later
 * kudos/reaction/moderation call. In the deployed monorepo the API sits behind
 * the same origin, so this is a same-origin cookie: no script can ever read it,
 * and the web app reads the member's identity back only through
 * `GET /api/v1/auth/session`.
 *
 * Failures surface as `ApiError` (see `lib/api-client.ts`), so the sign-in form
 * can branch on `status === 401` (wrong credentials) versus an unreachable API
 * (a plain fetch `TypeError`) without ever inspecting response text.
 */

import { apiGet, apiPost, type MemberRole } from "./api-client";

/** The signed-in member as `GET /api/v1/auth/session` returns it (ADR-1). */
export type { SessionMember } from "./api-client";

/**
 * Body of a successful login (EP-1).
 *
 * The member record the API already knows — the web app never receives (and
 * never stores) the password or its hash.
 */
export interface LoginResult {
  readonly id: string;
  readonly email: string;
  readonly role: MemberRole;
}

/** The shape `GET /api/v1/auth/session` (EP-2) answers with. */
export interface SessionMemberInfo {
  readonly email: string;
  readonly role: MemberRole;
}

/**
 * Exchanges credentials for the httpOnly session cookie (EP-1).
 *
 * Returns the signed-in member on 200. Throws `ApiError` with `status === 401`
 * for an unknown email or a wrong password; throws a plain `TypeError` when the
 * API cannot be reached at all.
 */
export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  return apiPost<LoginResult>("/auth/login", { email, password });
}

/**
 * Reads back the signed-in member (EP-2) so a screen can render their email and
 * role. Server-side callers should prefer `lib/session.ts`, which forwards the
 * httpOnly cookie; this export is the same call for client islands.
 */
export async function getSession(): Promise<SessionMemberInfo> {
  return apiGet<SessionMemberInfo>("/auth/session");
}
