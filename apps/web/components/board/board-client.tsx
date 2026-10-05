"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import EmptyState from "@/components/board/empty-state";
import KudosCard from "@/components/board/kudos-card";
import LiveIndicator from "@/components/board/live-indicator";
import type { LiveIndicatorState } from "@/components/board/live-indicator";
import Pagination from "@/components/board/pagination";
import KudosComposer from "@/components/composer/kudos-composer";
import HiddenToggle from "@/components/moderation/hidden-toggle";
import Alert from "@/components/ui/alert";
import Button from "@/components/ui/button";
import Skeleton from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/toaster";
import {
  ApiError,
  KUDOS_PAGE_SIZE,
  getKudosPage,
  type Kudos,
  type SessionMember,
} from "@/lib/api-client";
import {
  KUDOS_EXIT_FADE_MS,
  isLeadRole,
  listHiddenKudos,
} from "@/lib/api/moderation";
import {
  LIVE_MERGE_BUFFER,
  mergeKudos,
  readKudosPage,
  useLiveBoard,
} from "@/lib/hooks/use-live-board";
import { cn } from "@/lib/utils";

/**
 * BoardClient — the board's one client island (scr-board / scr-board-lead).
 *
 * The route server-renders page 1 (session + kudos) and hands it over; this
 * component composes the already-built pieces and owns nothing but board state:
 *
 * - `KudosComposer` — a 201 prepends the created card into slot 1 with the
 *   amber arrival wash (AC-7).
 * - `useLiveBoard` + `LiveIndicator` — `GET /api/v1/kudos?page=1` every 15s
 *   while the tab is visible, merged by id with no loading flash, so a kudos
 *   posted from another session appears on the open board (AC-13 / ADR-3).
 * - `KudosCard` wall — recipient, message, author + relative time, reaction
 *   counts, and the lead-only hide control (server-rendered role gate).
 * - `Pagination` — numbered pages + prev/next inside
 *   `nav[aria-label="Board pages"]`, page kept in the URL (`/?page=2`); page 1
 *   is SSR, pages 2+ fetch the next 20 client-side with 8 skeleton cards
 *   (AC-12, ADR-6).
 * - `HiddenToggle` — the lead-only "Hidden only" switch, which flips the list
 *   source to `GET /api/v1/kudos?hidden=true`.
 *
 * Every failure keeps the last good data on screen: a failed page fetch or poll
 * renders the inline alert with "Try again" instead of emptying the wall, and a
 * 401 anywhere routes to `/signin` (mirroring the API's 401 state).
 */

/** How many skeleton cards a client-side page fetch shows (cmp-skeleton). */
export const BOARD_SKELETON_COUNT = 8;

/** Copy of the board fetch error state (scr-board, "error — board fetch"). */
export const BOARD_FETCH_ERROR_MESSAGE = "Couldn't load the board.";

/** The retry affordance of that alert. */
export const BOARD_RETRY_LABEL = "Try again";

/** How long a freshly arrived card keeps its amber wash (~1.2s animation). */
export const ARRIVAL_HIGHLIGHT_MS = 1400;

/** sr-only announcement the aria-live board region makes per arrival. */
export function arrivalAnnouncement(recipient: string): string {
  return `New kudos for ${recipient}`;
}

/** Copy shown when a higher page comes back empty. */
export const END_OF_BOARD_MESSAGE = "You've reached the end of the board.";

/** Page count implied by a page that returned `count` items (ADR-6). */
export function inferPageCount(page: number, count: number): number {
  const safePage = Math.max(Math.trunc(page) || 1, 1);
  return count >= KUDOS_PAGE_SIZE ? safePage + 1 : safePage;
}

/** Props accepted by {@link BoardClient}. */
export interface BoardClientProps {
  /** The signed-in member, resolved server-side from the httpOnly cookie. */
  member: SessionMember;
  /** Page 1 (or the deep-linked page) as the server rendered it. */
  initialKudos: Kudos[];
  /** Which page `initialKudos` is; defaults to 1. */
  initialPage?: number;
}

/** One skeleton card — the card rhythm, held in place while a page loads. */
function BoardSkeletonCards({
  count = BOARD_SKELETON_COUNT,
}: {
  count?: number;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <li
          key={`board-skeleton-${index}`}
          aria-hidden="true"
          data-testid="skeleton-card"
          className="rounded-card border border-border bg-card px-4 py-5 shadow-card sm:px-[22px]"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-pill" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-[132px]" />
              <Skeleton className="h-2.5 w-[172px]" />
            </div>
            <Skeleton className="h-2.5 w-[52px]" />
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Skeleton className="h-3 w-[96%]" />
            <Skeleton className="h-3 w-[64%]" />
          </div>
          <div className="mt-5 flex gap-2">
            <Skeleton className="h-[26px] w-[66px] rounded-pill" />
            <Skeleton className="h-[26px] w-[58px] rounded-pill" />
          </div>
        </li>
      ))}
    </>
  );
}

export function BoardClient({
  member,
  initialKudos,
  initialPage = 1,
}: BoardClientProps) {
  const router = useRouter();
  const isLead = isLeadRole(member.role);
  const cap = KUDOS_PAGE_SIZE + LIVE_MERGE_BUFFER;

  // The wall the member sees (non-hidden view). Starts as the server rendered
  // it, so the first paint is real content — never a skeleton flash.
  const [wallItems, setWallItems] = useState<Kudos[]>(initialKudos);
  const [page, setPage] = useState(Math.max(initialPage, 1));
  const [pageCount, setPageCount] = useState(() =>
    inferPageCount(Math.max(initialPage, 1), initialKudos.length),
  );
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Lead-only review view ("Hidden only").
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [hiddenItems, setHiddenItems] = useState<Kudos[]>([]);
  const [hiddenLoading, setHiddenLoading] = useState(false);
  const [hiddenError, setHiddenError] = useState<string | null>(null);

  // Arrival + exit choreography.
  const [arrivingIds, setArrivingIds] = useState<string[]>([]);
  const [hidingIds, setHidingIds] = useState<string[]>([]);
  const [announcements, setAnnouncements] = useState<string[]>([]);

  const arrivalTimersRef = useRef<Set<number>>(new Set());
  const exitTimersRef = useRef<Set<number>>(new Set());
  const mergedLiveRef = useRef<Kudos[] | null>(null);

  /**
   * The 15s poll. It runs only for the live wall on page 1; pages 2+ and the
   * hidden review view are explicit fetches, and a hidden tab pauses it.
   */
  const live = useLiveBoard(initialPage === 1 ? initialKudos : [], {
    enabled: page === 1 && !hiddenOnly,
  });
  const liveRef = useRef(live);
  liveRef.current = live;

  /** Marks cards as arriving and schedules the wash to fade off. */
  const markArriving = useCallback((ids: readonly string[]): void => {
    const fresh = ids.filter((id) => id.length > 0);
    if (fresh.length === 0) {
      return;
    }
    setArrivingIds((current) => Array.from(new Set([...current, ...fresh])));
    for (const id of fresh) {
      const timer = window.setTimeout(() => {
        arrivalTimersRef.current.delete(timer);
        setArrivingIds((current) => current.filter((entry) => entry !== id));
      }, ARRIVAL_HIGHLIGHT_MS);
      arrivalTimersRef.current.add(timer);
    }
  }, []);

  /** Any 401 from any board call — the session is gone (ADR-1). */
  const handleUnauthenticated = useCallback((): void => {
    router.replace("/signin");
  }, [router]);

  // Merge each successful poll into the wall: incoming wins on shared ids (so
  // reaction counts refresh), locally posted kudos survive until the poll has
  // them, and the newest bubble to the top.
  useEffect(() => {
    if (live.kudos === mergedLiveRef.current) {
      return;
    }
    mergedLiveRef.current = live.kudos;
    if (page !== 1 || hiddenOnly) {
      return;
    }
    setWallItems((current) => mergeKudos(current, live.kudos, cap).items);
  }, [live.kudos, page, hiddenOnly, cap]);

  // Announce polled arrivals once, and light their amber wash.
  useEffect(() => {
    if (live.newArrivals.length === 0) {
      return;
    }
    markArriving(live.newArrivals.map((item) => item.id));
    setAnnouncements(
      live.newArrivals.map((item) => arrivalAnnouncement(item.recipient)),
    );
  }, [live.newArrivals, markArriving]);

  // A poll answered 401 — the board itself is no longer authenticated.
  useEffect(() => {
    if (live.signedOut) {
      handleUnauthenticated();
    }
  }, [live.signedOut, handleUnauthenticated]);

  // Never leave a timer behind.
  useEffect(() => {
    const arrivals = arrivalTimersRef.current;
    const exits = exitTimersRef.current;
    return () => {
      for (const timer of arrivals) {
        window.clearTimeout(timer);
      }
      for (const timer of exits) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  /** Writes the page into the URL without a document reload. */
  const writePageToUrl = useCallback((target: number): void => {
    if (typeof window === "undefined" || !window.history) {
      return;
    }
    const url = `${window.location.pathname}${target <= 1 ? "" : `?page=${target}`}`;
    try {
      window.history.pushState(window.history.state, "", url);
    } catch {
      // A history API that refuses the URL is not worth breaking the board for.
    }
  }, []);

  /** Fetches one board page client-side (pages 2+, or the hidden review). */
  const loadPage = useCallback(
    async (target: number, options: { hidden?: boolean } = {}): Promise<void> => {
      const hidden = options.hidden === true;

      if (hidden) {
        setHiddenLoading(true);
        setHiddenError(null);
      } else {
        setLoadingPage(true);
        setPageError(null);
      }

      try {
        if (hidden) {
          const outcome = await listHiddenKudos(target);
          if (outcome.ok) {
            setHiddenItems(outcome.kudos);
            return;
          }
          if (outcome.kind === "unauthenticated") {
            handleUnauthenticated();
            return;
          }
          setHiddenError(outcome.message);
          return;
        }

        const payload = await getKudosPage(target);
        const items = readKudosPage(payload);
        setWallItems(items);
        setPageCount((current) =>
          Math.max(current, target, inferPageCount(target, items.length)),
        );
      } catch (cause) {
        if (cause instanceof ApiError && cause.isUnauthenticated) {
          handleUnauthenticated();
          return;
        }
        if (hidden) {
          setHiddenError(BOARD_FETCH_ERROR_MESSAGE);
        } else {
          setPageError(BOARD_FETCH_ERROR_MESSAGE);
        }
      } finally {
        if (hidden) {
          setHiddenLoading(false);
        } else {
          setLoadingPage(false);
        }
      }
    },
    [handleUnauthenticated],
  );

  /** Pagination: keep the page in the URL, then fetch the next 20. */
  const goToPage = useCallback(
    (target: number): void => {
      const clamped = Math.min(Math.max(target, 1), Math.max(pageCount, 1));
      if (clamped === page && !hiddenOnly) {
        return;
      }
      setPage(clamped);
      writePageToUrl(clamped);
      void loadPage(clamped, { hidden: false });
    },
    [page, pageCount, hiddenOnly, loadPage, writePageToUrl],
  );

  /** The composer's 201: prepend the created kudos into slot 1 (AC-7). */
  const handleCreated = useCallback(
    (created: Kudos): void => {
      // The merge dedupes by id, sorts newest-first and caps at the page size +
      // buffer — so the created card lands in slot 1 whether the member is on
      // page 1 or deeper, and nothing else is dropped.
      setWallItems((current) => mergeKudos([created], current, cap).items);
      markArriving([created.id]);
      setAnnouncements([arrivalAnnouncement(created.recipient)]);
    },
    [cap, markArriving],
  );

  /** A lead hid a kudos: fade it out, then drop it from the list. */
  const handleHidden = useCallback((kudosId: string): void => {
    setHidingIds((current) => Array.from(new Set([...current, kudosId])));
    const timer = window.setTimeout(() => {
      exitTimersRef.current.delete(timer);
      setHidingIds((current) => current.filter((entry) => entry !== kudosId));
      setWallItems((current) => current.filter((item) => item.id !== kudosId));
      setHiddenItems((current) => current.filter((item) => item.id !== kudosId));
    }, KUDOS_EXIT_FADE_MS);
    exitTimersRef.current.add(timer);
  }, []);

  /** Reactions reconcile locally so counts never wait for the next poll. */
  const handleKudosChange = useCallback((updated: Kudos): void => {
    setWallItems((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    setHiddenItems((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
  }, []);

  /** The lead-only "Hidden only" switch flips the list source. */
  const handleHiddenOnlyChange = useCallback(
    (next: boolean): void => {
      setHiddenOnly(next);
      if (next) {
        void loadPage(1, { hidden: true });
        return;
      }
      // Back to the shared wall; if page 1 was never loaded here, get it.
      if (wallItems.length === 0) {
        void loadPage(1, { hidden: false });
      }
    },
    [loadPage, wallItems.length],
  );

  const isHiddenView = hiddenOnly;
  const showSkeletons = isHiddenView ? hiddenLoading : loadingPage;
  const listError = isHiddenView ? hiddenError : pageError;
  const retry = useCallback((): void => {
    if (isHiddenView) {
      void loadPage(1, { hidden: true });
      return;
    }
    if (page === 1 && liveRef.current.error !== null) {
      liveRef.current.retry();
      return;
    }
    void loadPage(page, { hidden: false });
  }, [isHiddenView, loadPage, page]);

  const items = isHiddenView ? hiddenItems : wallItems;
  const boardEmpty = !isHiddenView && items.length === 0 && page === 1;
  const hiddenEmpty = isHiddenView && items.length === 0;

  const liveState: LiveIndicatorState = live.isSyncing
    ? "syncing"
    : live.newArrivals.length > 0
      ? "fresh-arrival"
      : "idle";

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pt-8 pb-16 sm:px-6 md:px-12 md:pt-12">
      <Toaster />

      <div className="mb-6">
        <h1 className="type-display font-heading font-extrabold">Team Kudos</h1>
        <p className="type-body-s mt-1.5 text-muted-foreground">
          Say thanks in 280 characters or less. New kudos appear automatically —
          no refresh needed.
        </p>
      </div>

      {/* r-composer · the moment of giving thanks */}
      <KudosComposer
        onCreated={handleCreated}
        onUnauthenticated={handleUnauthenticated}
        className="mb-8"
      />

      {/* r-live / r-mod-bar · the quiet liveness caption + lead-only filter */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {!isHiddenView && items.length > 0 ? (
          <p
            className="type-overline text-muted-foreground"
            data-testid="live-board-label"
          >
            Live board
          </p>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-4">
          {!isHiddenView && items.length > 0 ? (
            <LiveIndicator
              state={liveState}
              pulseAt={live.lastMergedAt ? live.lastMergedAt.getTime() : null}
            />
          ) : null}
          {isLead ? (
            <HiddenToggle
              role={member.role}
              hiddenOnly={hiddenOnly}
              onHiddenChange={handleHiddenOnlyChange}
              disabled={hiddenLoading}
            />
          ) : null}
        </div>
      </div>

      {/* r-list · the wall */}
      <section
        id="board"
        aria-labelledby="board-heading"
        aria-busy={showSkeletons || undefined}
      >
        <h2 id="board-heading" className="sr-only">
          {isHiddenView ? "Hidden kudos" : "Kudos board"}
        </h2>

        {listError !== null ? (
          <Alert variant="error" className="mb-4" data-testid="board-error">
            <div className="flex flex-wrap items-center gap-3">
              <span>{listError}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={retry}
                data-testid="board-retry"
              >
                {BOARD_RETRY_LABEL}
              </Button>
            </div>
          </Alert>
        ) : null}

        <ul
          aria-live="polite"
          aria-label={isHiddenView ? "Hidden kudos list" : "Kudos list"}
          data-testid="board-list"
          data-page={isHiddenView ? 1 : page}
          data-hidden-only={isHiddenView ? "true" : "false"}
          className="flex flex-col gap-4"
        >
          {announcements.length > 0 ? (
            <li className="sr-only" data-testid="board-announcements">
              {announcements.join(". ")}
            </li>
          ) : null}

          {showSkeletons ? (
            <BoardSkeletonCards />
          ) : items.length === 0 ? (
            <li>
              {boardEmpty || hiddenEmpty ? (
                <EmptyState
                  variant={hiddenEmpty ? "hidden-empty" : "board-empty"}
                />
              ) : (
                <p
                  className="type-body-s rounded-card border border-dashed border-border bg-card px-6 py-10 text-center text-muted-foreground"
                  data-testid="board-end"
                >
                  {END_OF_BOARD_MESSAGE}
                </p>
              )}
            </li>
          ) : (
            items.map((item) => (
              <li key={item.id}>
                <KudosCard
                  kudos={item}
                  role={member.role}
                  viewerEmail={member.email}
                  arriving={arrivingIds.includes(item.id)}
                  hiding={hidingIds.includes(item.id)}
                  hidden={isHiddenView}
                  onKudosChange={handleKudosChange}
                  onHidden={handleHidden}
                  onUnauthenticated={handleUnauthenticated}
                />
              </li>
            ))
          )}
        </ul>
      </section>

      {/* r-pagination · numbered pages + prev/next, page in the URL */}
      {!isHiddenView ? (
        <Pagination
          page={page}
          pageCount={pageCount}
          onPageChange={goToPage}
          className={cn("mt-8", loadingPage && "opacity-70")}
        />
      ) : null}
    </div>
  );
}

export default BoardClient;
