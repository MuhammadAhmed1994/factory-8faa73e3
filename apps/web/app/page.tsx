import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import AppHeader from "@/components/app-header";
import BoardClient from "@/components/board/board-client";
import {
  SESSION_COOKIE_NAME,
  getSession,
  getKudosPage,
  type Kudos,
  type KudosPage,
  type SessionMember,
} from "@/lib/api-client";

/**
 * `/` — the board (scr-board / scr-board-lead), the product's home.
 *
 * A Server Component end to end except for the one `BoardClient` island:
 *
 * 1. The session is resolved from the **httpOnly** cookie (`kudos_session`) via
 *    `GET /api/v1/auth/session`, forwarding the cookie explicitly — the browser
 *    JavaScript never sees it (ADR-1).
 * 2. An unauthenticated visit (missing cookie, or a session the API answers 401
 *    for) is redirected to `/signin`, mirroring the API's own 401 state (AC-3).
 * 3. Page 1 of the wall is server-rendered from `GET /api/v1/kudos?page=1`
 *    (EP-3) with the same forwarded cookie, newest first, 20 per page (ADR-6),
 *    and handed to `BoardClient` together with the session — so the first paint
 *    is real content and the skeleton state never flashes on a first visit.
 *
 * Deep links (`/?page=2`) render the same shell; `BoardClient` fetches that
 * page client-side and keeps the page in the URL.
 */
export const metadata = {
  title: "Team Kudos",
  description: "Post short kudos to a colleague and watch the live board.",
};

/** Session reads and the server-rendered board read must never be cached. */
export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const requested = Number.parseInt(String(params?.page ?? "1"), 10);
  const page =
    Number.isFinite(requested) && requested >= 1 ? Math.trunc(requested) : 1;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const cookieHeader =
    sessionCookie !== undefined && sessionCookie.length > 0
      ? `${SESSION_COOKIE_NAME}=${sessionCookie}`
      : null;

  // No cookie to forward — there is no member to render the board for.
  if (cookieHeader === null) {
    redirect("/signin");
  }

  const member = await resolveMember(cookieHeader);
  if (member === null) {
    redirect("/signin");
  }

  const kudos = await fetchBoardPage(page, cookieHeader);

  return (
    <>
      <AppHeader member={member} />
      <main>
        <BoardClient member={member} initialKudos={kudos} initialPage={page} />
      </main>
    </>
  );
}

/**
 * `GET /api/v1/auth/session` with the forwarded cookie, or `null` when the
 * session is missing/invalid/unreachable — the caller redirects to `/signin`.
 */
async function resolveMember(
  cookieHeader: string,
): Promise<SessionMember | null> {
  try {
    return await getSession(cookieHeader);
  } catch {
    // A 401 (unknown/expired session) as much as an unreachable API means
    // "no member to render for" here; the redirect mirrors the API's 401.
    return null;
  }
}

/**
 * Reads the kudos array out of a `GET /api/v1/kudos` payload, accepting either
 * the paginated envelope (`{ data, page, pageSize, total }`) or a bare array.
 *
 * Server-side twin of the client hook's `readKudosPage`: this route must not
 * import a plain function out of a `"use client"` module (the Server Component
 * would receive a client-reference proxy for it), so the same three-line
 * normalisation lives here, next to its only server-side caller.
 */
function toKudosList(payload: KudosPage | Kudos[]): Kudos[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
}

/**
 * `GET /api/v1/kudos?page=N` with the forwarded cookie (EP-3), normalised to
 * the wall's `Kudos[]`.
 *
 * A failed board read must not bounce a signed-in member off their board: the
 * shell renders with an empty page and `BoardClient` shows its inline fetch
 * error with "Try again" — the designed "error — board fetch" state, which
 * keeps whatever last good data it already holds on screen.
 */
async function fetchBoardPage(
  page: number,
  cookieHeader: string,
): Promise<Kudos[]> {
  try {
    return toKudosList(await getKudosPage(page, cookieHeader));
  } catch {
    return [];
  }
}
