import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/api-client";

/**
 * Route protection for the board (mirrors AC-3 on the web side).
 *
 * - An unauthenticated request to `/` (no session cookie present) is redirected
 *   to `/signin`.
 * - `/signin` and Next.js' own assets (`/_next/*`, static files, favicon, and
 *   the API surface proxied by `next.config.ts` rewrites) stay public.
 * - Middleware only inspects cookie *presence*: the cookie is httpOnly and the
 *   authoritative check happens server-side against the API (ADR-1), where a
 *   missing/invalid session yields 401 and `lib/session.ts` yields `null`.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public surface: the sign-in route itself and everything Next.js serves.
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const hasSession =
    request.cookies.get(SESSION_COOKIE_NAME)?.value !== undefined &&
    request.cookies.get(SESSION_COOKIE_NAME)?.value !== "";

  if (!hasSession) {
    const signInUrl = new URL("/signin", request.url);
    // Remember where the member was heading so the sign-in flow can return.
    signInUrl.searchParams.set("next", pathname);
    const response = NextResponse.redirect(signInUrl);
    response.headers.set("x-kudos-auth", "redirected-to-signin");
    return response;
  }

  return NextResponse.next();
}

/** Matcher entries every request must pass through before reaching a route. */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/v1).*)"],
};

function isPublicPath(pathname: string): boolean {
  if (pathname === "/signin" || pathname === "/sign-in") {
    return true;
  }
  if (pathname.startsWith("/_next")) {
    return true;
  }
  if (pathname === "/favicon.ico" || pathname.startsWith("/icons/")) {
    return true;
  }
  if (pathname.startsWith("/api/")) {
    return true;
  }
  // Static assets served from `public/`.
  if (/\.(png|jpg|jpeg|svg|webp|ico|txt|xml|webmanifest|css|js|map|woff2?)$/.test(pathname)) {
    return true;
  }
  return false;
}
