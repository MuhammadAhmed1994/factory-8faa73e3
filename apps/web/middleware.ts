import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookieName } from "@/lib/api-client";

/**
 * Route protection (mirrors AC-3 at the page level).
 *
 * Requests to the board (`/`) without a session cookie are redirected to
 * `/signin`. `/signin` itself and Next.js' own assets (`/_next/*`, `favicon.ico`)
 * stay public so the sign-in screen and static chunks always load.
 *
 * Presence of the cookie is enough here — it is httpOnly and opaque, so only the
 * API can judge validity. When the session turns out to be stale, the page's
 * server-side `getSessionMember()` returns `null` and the API's 401s route the
 * member back to `/signin`.
 */

/** Paths that must never require a session. */
const PUBLIC_PATHS = new Set<string>(["/signin"]);

/** True for Next.js internal asset requests. */
function isNextAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/favicon")
  );
}

/** True when the request carries any value for the session cookie. */
function hasSessionCookie(request: NextRequest): boolean {
  const value = request.cookies.get(getSessionCookieName())?.value;
  return value !== undefined && value.trim() !== "";
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Public: the sign-in screen itself and Next.js assets.
  if (PUBLIC_PATHS.has(pathname) || isNextAsset(pathname)) {
    return NextResponse.next();
  }

  // Authenticated: any other path needs a session cookie.
  if (hasSessionCookie(request)) {
    return NextResponse.next();
  }

  const signInUrl = new URL("/signin", request.url);
  // Preserve where the member was headed so sign-in can send them back.
  const target = `${pathname}${search}`;
  if (target !== "/" && target !== "") signInUrl.searchParams.set("from", target);
  return NextResponse.redirect(signInUrl);
}

/** Only the board (and future app routes) pass through the guard. */
export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
