"use client";

/**
 * BoardClient — the board's one client island (scr-board / scr-board-lead).
 *
 * The route (`app/page.tsx`) is a Server Component: it resolves the session from
 * the httpOnly cookie and server-renders page 1 of `GET /api/v1/kudos`, so the
 * first paint shows real cards and never a skeleton. Everything interactive is
 * composed here:
 *
 * - the composer, whose `201` prepends the created card at slot 1 with the
 *   amber arrival highlight (AC-7);
 * - `useLiveBoard`, which polls page 1 every 15s while the tab is visible and
 *   merges by id — no loading flash, no manual reload (AC-13);
 * - the lead-only `Hidden only` toggle, which switches the list source to
 *   `GET /api/v1/kudos?hidden=true`;
 * - numbered pagination, which keeps the page in the URL (`?page=2`) and fetches
 *   pages 2+ client-side (AC-12);
 * - per-card reactions and, for a lead, the hide control.
 *
 * Errors stay distinct by transport: a client-side fetch failure renders the
 * inline `Couldn't load the board.` alert with a `Try again` control while the
 * last good list stays rendered, and any `401` routes to `/signin`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { KudosComposer } from "@/components/composer/kudos-composer";
import { HideControl } from "@/components/moderation/hide-control";
import {
  HiddenOnlyList,
  HiddenToggle,
} from "@/components/moderation/hidden-toggle";
import { LiveIndicator } from "@/components/board/live-indicator";
import { KudosCard, arrivalAnnouncement } from "@/components/board/kudos-card";
import { Pagination } from "@/components/board/pagination";
import { EmptyState } from "@/components/board/empty-state";
import {
  apiGet,
  isApiError,
  type Kudos,
  type KudosPage,
  type MemberRole,
} from "@/lib/api-client";
import {
  compareKudosNewestFirst,
  mergeKudosPages,
  useLiveBoard,
} from "@/lib/hooks/use-live-board";
import { listHiddenKudos, type HiddenKudos } from "@/lib/api/moderation";

/** Subtitle under the page's `h1` (the route owns the heading itself). */
export const BOARD_SUBTITLE = "Say thanks in 280 characters or less.";

/** Accessible name of the wall. */
export const BOARD_LIST_LABEL = "Kudos board";

/** Eyebrow over the lead-only hidden review view. */
export const HIDDEN_VIEW_LABEL = "Hidden";

/** Copy of the board fetch-failure state (scr-board · error). */
export const BOARD_ERROR_MESSAGE = "Couldn't load the board.";

/** The retry affordance inside that alert. */
export const BOARD_RETRY_LABEL = "Try again";

/** Copy of the hidden-list failure state. */
export const HIDDEN_ERROR_MESSAGE = "Couldn't load hidden kudos.";

/**
 * Copy of the hidden-list 403 state — a defensive notice, since only leads are
 * ever offered the toggle that triggers it.
 */
export const HIDDEN_FORBIDDEN_MESSAGE =
  "Only team leads can review hidden kudos.";

/** How many skeleton cards cover a client-side page fetch (cmp-skeleton). */
export const SKELETON_COUNT = 8;

/**
 * How long a card keeps `data-arriving`. Matches the ~1.2s the amber wash takes
 * to fade off (`--motion-arrival`), which `prefers-reduced-motion` collapses.
 */
export const ARRIVAL_HIGHLIGHT_MS = 1200;

/** Where any 401 sends the member (AC-3). */
const SIGN_IN_PATH = "/signin";

/** Fixed board page size (ADR-6). */
const PAGE_SIZE = 20;

/**
 * The arrival-highlight timer handle.
 *
 * `ReturnType<typeof setTimeout>` rather than `number`: the DOM lib types the
 * browser's timer as a `number`, Node's as a `Timeout` object, and this island
 * is unit-tested under Node's timers.
 */
type ArrivalTimer = ReturnType<typeof setTimeout>;

/** Total pages from a `total`; always at least 1 so page 1 stays addressable. */
const totalPagesFor = (total: number): number =>
  Math.max(1, Math.ceil(total / PAGE_SIZE));

/** Props for {@link BoardClient}. */
export interface BoardClientProps {
  /** Page 1 of the visible board, newest first (SSR — never a skeleton flash). */
  readonly initialKudos: readonly Kudos[];
  /** Page the route rendered; `1` for the plain `/` URL, `N` for `/?page=N`. */
  readonly initialPage: number;
  /** Total visible kudos the server reported, which drives the page count. */
  readonly initialTotal: number;
  /** Signed-in member's email. */
  readonly email: string;
  /** Session role; `LEAD` unlocks the hidden review view and hide controls. */
  readonly role: MemberRole;
  /** Extra class names for the column. */
  readonly className?: string;
}

/** Props for {@link BoardSkeletons}. */
export interface BoardSkeletonsProps {
  /** Defaults to {@link SKELETON_COUNT}. */
  readonly count?: number;
  /** Extra class names. */
  readonly className?: string;
}

/**
 * The skeleton wall (cmp-skeleton): 8 cards with a real card's rhythm — an
 * avatar circle, two text bars and three chip pills — `aria-hidden`, covered by
 * a single `Loading the board…` status, because the shapes alone carry no
 * meaning.
 *
 * Only ever shown on a *client-side* page fetch: page 1 arrives server-rendered,
 * so a first visit never flashes it.
 */
export function BoardSkeletons({
  count = SKELETON_COUNT,
  className,
}: BoardSkeletonsProps) {
  return (
    <div
      data-testid="board-skeletons"
      data-count={count}
      className={cn("flex flex-col gap-4", className)}
    >
      <p role="status" className="sr-only">
        Loading the board…
      </p>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="kudos-card rounded-card border border-border bg-card p-5 shadow-card"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-pill" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-[132px]" />
              <Skeleton className="h-2.5 w-[172px]" />
            </div>
            <Skeleton className="h-2.5 w-[52px]" />
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            <Skeleton className="h-3 w-[96%]" />
            <Skeleton className="h-3 w-[64%]" />
          </div>
          <div className="mt-5 flex gap-2">
            <Skeleton className="h-6 w-[66px] rounded-pill" />
            <Skeleton className="h-6 w-[58px] rounded-pill" />
            <Skeleton className="h-6 w-[58px] rounded-pill" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The retry control shared by both inline fetch-error alerts. */
function RetryButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "ml-auto shrink-0 rounded-pill border border-destructive/40 px-2.5 py-0.5",
        "text-caption font-medium text-destructive transition duration-base ease-enter",
        "hover:bg-destructive/10",
      )}
    >
      {BOARD_RETRY_LABEL}
    </button>
  );
}

/**
 * The board's client island.
 *
 * The visible board's page 1 is the merge of what the 15s poll has seen
 * (`live.kudos`) and the board's own local edits — the composer's prepend, a
 * reconciled reaction, a locally hidden card — so no edit is ever clobbered by
 * a poll that raced it. Pages 2+ and the hidden review view are fetched on
 * demand instead, because polling page 1 would overwrite either of them.
 */
export function BoardClient({
  initialKudos,
  initialPage,
  initialTotal,
  email,
  role,
  className,
}: BoardClientProps) {
  const router = useRouter();
  const isLead = role === "LEAD";

  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(initialTotal);
  const [pagedKudos, setPagedKudos] = useState<readonly Kudos[] | null>(
    initialPage === 1 ? initialKudos : null,
  );
  const [fetchingPage, setFetchingPage] = useState(initialPage !== 1);
  const [fetchError, setFetchError] = useState<string | null>(null);

  /** The lead-only `Hidden only` view. */
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [hiddenItems, setHiddenItems] = useState<readonly HiddenKudos[] | null>(
    null,
  );
  const [hiddenLoading, setHiddenLoading] = useState(false);
  const [hiddenError, setHiddenError] = useState<string | null>(null);

  /** The board's own edits, layered over the poll's page 1. */
  const [localKudos, setLocalKudos] = useState<readonly Kudos[]>(initialKudos);

  /** Ids whose cards arrived on this pass — the amber wash + the announcement. */
  const [arrivingIds, setArrivingIds] = useState<readonly string[]>([]);
  const [announcements, setAnnouncements] = useState<readonly string[]>([]);

  const arrivalTimerRef = useRef<ArrivalTimer | null>(null);
  /** Ids the lead hid locally; a poll that still carries one is filtered out. */
  const hiddenLocallyRef = useRef<ReadonlySet<string>>(new Set());
  /** Everything the wall has ever shown, so an arrival is detected exactly once. */
  const knownIdsRef = useRef<ReadonlySet<string>>(
    new Set(initialKudos.map((kudos) => kudos.id)),
  );
  /** The server-rendered pass is not an arrival — the board simply has content. */
  const firstPassRef = useRef(true);
  /** Guards the one client-side fetch a deep link to `/?page=N` needs. */
  const deepLinkFetchRef = useRef(initialPage !== 1);

  /** Where any 401 from the composer, a reaction, a poll or a page fetch goes. */
  const redirectToSignIn = useCallback(() => {
    router.replace(SIGN_IN_PATH);
  }, [router]);

  /**
   * The 15s poll. `initialKudos` is the server-rendered page 1, so the wall is
   * already populated: no skeleton, no loading flash, no manual reload (AC-13).
   */
  const live = useLiveBoard(initialKudos);

  useEffect(() => {
    if (live.signedOut) redirectToSignIn();
  }, [live.signedOut, redirectToSignIn]);

  /** The visible board's page 1: poll ∪ local edits, minus locally hidden rows. */
  const boardPage1 = useMemo(() => {
    const merged = mergeKudosPages(live.kudos, localKudos, 0);
    const hiddenLocally = hiddenLocallyRef.current;
    return hiddenLocally.size === 0
      ? merged
      : merged.filter((kudos) => !hiddenLocally.has(kudos.id));
  }, [live.kudos, localKudos]);

  /** The list the wall renders right now. */
  const list = page === 1 ? boardPage1 : (pagedKudos ?? []);

  /** Highlights and announces whatever is new on the wall, exactly once each. */
  useEffect(() => {
    const known = knownIdsRef.current;
    const fresh = boardPage1.filter((kudos) => !known.has(kudos.id));

    knownIdsRef.current = new Set(boardPage1.map((kudos) => kudos.id));

    if (firstPassRef.current) {
      firstPassRef.current = false;
      return;
    }
    if (fresh.length === 0) return;

    setArrivingIds(fresh.map((kudos) => kudos.id));
    setAnnouncements(fresh.map((kudos) => arrivalAnnouncement(kudos.recipient)));

    if (arrivalTimerRef.current !== null) {
      clearTimeout(arrivalTimerRef.current);
    }
    arrivalTimerRef.current = setTimeout(() => {
      arrivalTimerRef.current = null;
      setArrivingIds([]);
      setAnnouncements([]);
    }, ARRIVAL_HIGHLIGHT_MS);
  }, [boardPage1]);

  // Releases the arrival timer if the board unmounts mid-highlight.
  useEffect(
    () => () => {
      if (arrivalTimerRef.current !== null) {
        clearTimeout(arrivalTimerRef.current);
      }
    },
    [],
  );

  /** Fetches one page of the visible board, client-side (pages 2+). */
  const fetchPage = useCallback(
    async (nextPage: number): Promise<void> => {
      setFetchingPage(true);
      setFetchError(null);
      try {
        const body = await apiGet<KudosPage>(
          `/kudos?page=${encodeURIComponent(String(nextPage))}`,
        );
        const items = Array.isArray(body.items) ? body.items : [];
        setPagedKudos(items);
        setTotal(typeof body.total === "number" ? body.total : items.length);
        setPage(nextPage);
      } catch (error) {
        if (isApiError(error) && error.isUnauthorized) {
          redirectToSignIn();
          return;
        }
        // The last good page stays rendered while the member decides to retry.
        setFetchError(BOARD_ERROR_MESSAGE);
      } finally {
        setFetchingPage(false);
      }
    },
    [redirectToSignIn],
  );

  /**
   * A deep link straight to `/?page=N` has nothing server-side inside the island
   * yet, so it needs exactly one client-side fetch of its own page.
   */
  useEffect(() => {
    if (!deepLinkFetchRef.current) return;
    deepLinkFetchRef.current = false;
    void fetchPage(initialPage);
  }, [fetchPage, initialPage]);

  /**
   * Writes the page into the URL without a navigation, so moving across the
   * wall costs no second fetch and no flash. `history.replaceState` is the App
   * Router-sanctioned way to hold URL state client-side; reloading that URL
   * then server-renders the same page.
   */
  const goToPage = useCallback(
    (nextPage: number) => {
      if (nextPage === page || fetchingPage) return;

      const url = nextPage === 1 ? "/" : `/?page=${nextPage}`;
      if (
        typeof window !== "undefined" &&
        typeof window.history?.replaceState === "function"
      ) {
        window.history.replaceState(null, "", url);
      } else {
        router.replace(url);
      }

      void fetchPage(nextPage);
    },
    [fetchPage, fetchingPage, page, router],
  );

  /** Fetches the lead-only hidden review list. */
  const fetchHidden = useCallback(async (): Promise<void> => {
    setHiddenLoading(true);
    setHiddenError(null);
    try {
      const outcome = await listHiddenKudos(1);
      if (outcome.kind === "ok") {
        setHiddenItems(outcome.page.items);
        return;
      }
      if (outcome.kind === "unauthorized") {
        redirectToSignIn();
        return;
      }
      setHiddenItems([]);
      setHiddenError(
        outcome.kind === "forbidden"
          ? HIDDEN_FORBIDDEN_MESSAGE
          : HIDDEN_ERROR_MESSAGE,
      );
    } finally {
      setHiddenLoading(false);
    }
  }, [redirectToSignIn]);

  /** The composer's `201`: prepend the created card, with the arrival wash. */
  const handleCreated = useCallback((created: Kudos) => {
    setLocalKudos((previous) =>
      [created, ...previous].sort(compareKudosNewestFirst),
    );
    setTotal((previous) => previous + 1);
  }, []);

  /** A reaction's 2xx: reconcile that one kudos against the server's body. */
  const handleReactionSaved = useCallback((updated: Kudos) => {
    setLocalKudos((previous) =>
      previous.map((kudos) => (kudos.id === updated.id ? updated : kudos)),
    );
  }, []);

  /** A hide's 2xx: drop the card from the wall for this session immediately. */
  const handleHiddenKudos = useCallback((kudosId: string) => {
    hiddenLocallyRef.current = new Set([
      ...hiddenLocallyRef.current,
      kudosId,
    ]);
    setLocalKudos((previous) =>
      previous.filter((kudos) => kudos.id !== kudosId),
    );
    setTotal((previous) => Math.max(0, previous - 1));
    setHiddenItems((previous) =>
      previous === null
        ? previous
        : previous.filter((kudos) => kudos.id !== kudosId),
    );
  }, []);

  const totalPages = totalPagesFor(total);

  const hiddenSkeletons = hiddenOnly && hiddenLoading;
  const boardSkeletons =
    !hiddenOnly && fetchingPage && (pagedKudos ?? []).length === 0;
  const boardEmpty = !hiddenOnly && !boardSkeletons && list.length === 0;
  const showBoard = !hiddenOnly && !boardSkeletons && !boardEmpty;
  const showPagination = showBoard && !fetchingPage;

  /**
   * The live caption waits for the first kudos (scr-board · empty board:
   * "no pagination, no live indicator yet — it appears with the first kudos").
   * An empty board has nothing to keep live, so the composer is left alone as
   * the single focus of the page.
   */
  const showLiveIndicator = !hiddenOnly && !boardEmpty;

  return (
    <div
      data-role={role}
      data-page={page}
      data-hidden-only={hiddenOnly ? "true" : "false"}
      className={cn("flex w-full flex-col", className)}
    >
      {/* r-composer · Say thanks */}
      <KudosComposer
        onCreated={handleCreated}
        onUnauthorized={redirectToSignIn}
        className="mb-8"
      />

      {/* r-live · the live caption, or the hidden view's eyebrow */}
      {showLiveIndicator || hiddenOnly ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {hiddenOnly ? (
            <p className="text-overline uppercase text-muted-foreground">
              {HIDDEN_VIEW_LABEL}
            </p>
          ) : (
            <LiveIndicator
              state={live.isSyncing ? "syncing" : "idle"}
              pulse={live.newArrivals.length > 0}
            />
          )}

          <HiddenToggle
            role={role}
            hidden={hiddenOnly}
            onHiddenChange={(next) => {
              setHiddenOnly(next);
              if (next && hiddenItems === null && !hiddenLoading) {
                void fetchHidden();
              }
            }}
          />
        </div>
      ) : null}

      {/*
       * The arrival announcements. A separate polite region *beside* the list:
       * an `aria-live` container that also held the cards would re-announce the
       * whole wall on every poll, so this additions-only region speaks just the
       * new cards — "New kudos for {recipient}" — once each (a11y requirement).
       */}
      <p
        aria-live="polite"
        aria-relevant="additions"
        data-testid="board-announcements"
        className="sr-only"
      >
        {announcements.join(" ")}
      </p>

      {/* r-list · the wall, or the lead's hidden review view */}
      <section aria-labelledby="board-heading" id="board">
        <h2 id="board-heading" className="sr-only">
          {BOARD_LIST_LABEL}
        </h2>

        {hiddenOnly ? (
          hiddenSkeletons ? (
            <BoardSkeletons />
          ) : hiddenError !== null ? (
            <div data-testid="board-hidden-error">
              <Alert variant="error">
                <span>{hiddenError}</span>
                <RetryButton onClick={() => void fetchHidden()} />
              </Alert>
            </div>
          ) : (
            <HiddenOnlyList items={hiddenItems ?? []} />
          )
        ) : boardSkeletons ? (
          <BoardSkeletons />
        ) : fetchError !== null && list.length === 0 ? (
          <div data-testid="board-fetch-error">
            <Alert variant="error">
              <span>{fetchError}</span>
              <RetryButton onClick={() => void fetchPage(page)} />
            </Alert>
          </div>
        ) : boardEmpty ? (
          <EmptyState variant="board-empty" />
        ) : (
          <ul
            aria-label={BOARD_LIST_LABEL}
            data-testid="board-list"
            className="flex flex-col gap-4"
          >
            {list.map((kudos) => (
              <li key={kudos.id}>
                <KudosCard
                  kudos={kudos}
                  authoredByViewer={kudos.author.email === email}
                  arriving={arrivingIds.includes(kudos.id)}
                  onReactionSaved={handleReactionSaved}
                  onUnauthorized={redirectToSignIn}
                  leadActions={
                    isLead ? (
                      <HideControl
                        kudosId={kudos.id}
                        role={role}
                        onHidden={handleHiddenKudos}
                      />
                    ) : undefined
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* r-pagination · numbered pages + prev/next, `Page N of M` */}
      {showPagination && totalPages > 1 ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={goToPage}
          loading={fetchingPage}
          className="mt-8"
        />
      ) : null}
    </div>
  );
}

export default BoardClient;
