import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { BoardClient } from "@/components/board/board-client";
import {
  apiGet,
  getSessionCookieName,
  isApiError,
  sessionCookieHeader,
  type Kudos,
  type KudosPage,
} from "@/lib/api-client";
import { getSessionMember } from "@/lib/session";

/**
 * `/` — `scr-board` (member) and `scr-board-lead` (lead): the product's home.
 *
 * A Server Component, per the architecture rule. The board page server-renders
 * page 1 from `GET /api/v1/kudos?page=1` with the httpOnly session cookie
 * forwarded, so the first paint shows real cards — the wall is never fetched in
 * a client `useEffect` before first paint, which is exactly what would make the
 * skeleton flash on every visit.
 *
 * Order of operations:
 *
 * 1. read the session (`email` + `role`) from the httpOnly cookie — a missing or
 *    stale session redirects to `/signin`, mirroring the API's 401 (AC-3);
 * 2. read `?page=` so a deep link or a reload server-renders *that* page;
 * 3. fetch the page with the cookie attached and hand it, plus the session, to
 *    the {@link BoardClient} island, which owns every interactive piece.
 *
 * A session that resolves but whose board fetch still answers 401 (revoked
 * between the two calls) redirects too. An unreachable API is *not* a redirect:
 * the island renders the board's `Couldn't load the board.` state with its
 * `Try again` control, which is client-side where the retry belongs.
 */

/** Fixed board page size (ADR-6); duplicated so the page owns its own math. */
const PAGE_SIZE = 20;

/** Where an unauthenticated visit goes (AC-3). */
const SIGN_IN_PATH = "/signin";

/** Query parameter holding the current page, so a position is shareable. */
const PAGE_PARAM = "page";

/** Parses a 1-based `?page=` value, falling back to page 1. */
function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

/** Props for the board route. */
interface BoardPageProps {
  /** `?page=` from the App Router; a promise under Next.js 15. */
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}

/**
 * The board page.
 */
async function BoardPage({ searchParams }: BoardPageProps) {
  // A null session — no cookie, or a 401 from the API — is the redirect case.
  const member = await getSessionMember();
  if (member === null) redirect(SIGN_IN_PATH);

  const params = (await searchParams) ?? {};
  const page = parsePage(params[PAGE_PARAM]);

  // Server-render the requested page; page 1 is also the poll's page.
  const board = await fetchBoardPage(page);

  return (
    <>
      <AppHeader email={member.email} role={member.role} />

      <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-16 sm:px-6 lg:pt-12">
        <div className="mb-6">
          <h1 className="font-heading text-display text-foreground">
            Team Kudos
          </h1>
          <p className="mt-1.5 text-body-s text-muted-foreground">
            Say thanks in 280 characters or less.
          </p>
        </div>

        <BoardClient
          initialKudos={board.items}
          initialPage={board.page}
          initialTotal={board.total}
          email={member.email}
          role={member.role}
        />
      </main>
    </>
  );
}

/**
 * Fetches one page of the visible board server-side.
 *
 * `credentials: "include"` is meaningless in a server fetch, so the httpOnly
 * cookie travels as an explicit `Cookie` header — the only way it can. A 401
 * redirects to `/signin`; any other failure hands the island an empty page so
 * the board still paints and its own error state can take over.
 */
async function fetchBoardPage(page: number): Promise<KudosPage> {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value ?? "";
  const cookie = sessionCookieHeader(token);

  try {
    const body = await apiGet<KudosPage>(
      `/kudos?page=${encodeURIComponent(String(page))}`,
      { cookie, cache: "no-store" },
    );

    const items: readonly Kudos[] = Array.isArray(body.items) ? body.items : [];

    return {
      items,
      page: typeof body.page === "number" ? body.page : page,
      pageSize:
        typeof body.pageSize === "number" ? body.pageSize : PAGE_SIZE,
      total: typeof body.total === "number" ? body.total : items.length,
    };
  } catch (error) {
    if (isApiError(error) && error.isUnauthorized) {
      redirect(SIGN_IN_PATH);
    }

    // Unreachable or misbehaving API: paint an empty board and let the island's
    // fetch-error state, with its `Try again`, own the recovery.
    return {
      items: [],
      page,
      pageSize: PAGE_SIZE,
      total: 0,
    };
  }
}

export default BoardPage;
