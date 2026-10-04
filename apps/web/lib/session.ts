import { cookies } from "next/headers";

import {
  ApiError,
  SESSION_COOKIE_NAME,
  getSession,
  type SessionMember,
} from "@/lib/api-client";

export type { SessionMember } from "@/lib/api-client";
export { ApiError, SESSION_COOKIE_NAME } from "@/lib/api-client";

/**
 * Resolves the signed-in member **server-side** from the httpOnly session
 * cookie (ADR-1).
 *
 * Reads the cookie with `next/headers` (no client JS can see it) and calls
 * `GET /api/v1/auth/session`. Any 401 — missing cookie, unknown or expired
 * session — resolves to `null`, which is the caller's signal to redirect to
 * `/signin` rather than render a half-authenticated screen.
 */
export async function getCurrentMember(): Promise<SessionMember | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) {
    return null;
  }

  try {
    return await getSession(`${SESSION_COOKIE_NAME}=${sessionCookie}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    // A 5xx / network failure is not "signed out": rethrow so the route can
    // render its error boundary instead of silently bouncing to /signin.
    throw error;
  }
}
