import { cookies } from "next/headers";
import {
  ApiError,
  apiGet,
  getSessionCookieName,
  sessionCookieHeader,
  type SessionMember,
} from "./api-client";

/**
 * Resolves the signed-in member on the server (ADR-1).
 *
 * The session lives in an httpOnly cookie, so it can only be read here — never
 * in a Client Component. This helper forwards the cookie to
 * `GET /api/v1/auth/session` and returns `{ email, role }`.
 *
 * A missing cookie or a 401 from the API both mean "not signed in" and return
 * `null`; any other failure (API unreachable, 5xx) propagates so callers can
 * render an error state rather than silently treating a signed-in member as
 * anonymous.
 */
export async function getSessionMember(
  baseUrl?: string,
): Promise<SessionMember | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;

  if (!token || token.trim() === "") return null;

  try {
    return await apiGet<SessionMember>("/auth/session", {
      cookie: sessionCookieHeader(token),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/**
 * True when the session belongs to a team lead, who sees the quiet hide control
 * on each kudos (ADR-5).
 */
export function isLead(member: SessionMember | null | undefined): boolean {
  return member?.role === "LEAD";
}
