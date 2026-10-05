"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  BOARD_POLL_INTERVAL_MS,
  KUDOS_PAGE_SIZE,
  getKudosPage,
  type Kudos,
  type KudosPage,
} from "@/lib/api-client";

/**
 * Board liveness hook (ADR-3) — 15s polling of page 1, merged by id.
 *
 * The board page server-renders page 1 and passes it as `initialKudos`; this
 * hook keeps that list fresh without ever replacing it with a loading state, so
 * a kudos posted from another signed-in session appears at the top of the open
 * board within one ~15s tick (AC-13) and the wall stays interactive the whole
 * time (no SSE/WebSocket, no manual reload).
 *
 * Behaviour:
 * - Polls `GET /api/v1/kudos?page=1` (EP-3, via the shared api client) every
 *   {@link BOARD_POLL_INTERVAL_MS} **only while `document.visibilityState` is
 *   `"visible"`**. The interval is torn down while the tab is hidden; returning
 *   to the tab triggers one immediate catch-up poll.
 * - Never fetches on mount and never flips the list into a loading state — the
 *   only signal exposed during a poll is `isSyncing`, which the board renders as
 *   the quiet LiveIndicator dot, not as skeletons.
 * - Merges each successful page by deduping on `id` (incoming wins, so reaction
 *   counts refresh), sorting `createdAt` desc with `id` desc as the stable
 *   tiebreak (ADR-6), and capping the result at the page size + buffer.
 * - On failure the last good data is kept and a retryable error is exposed; a
 *   401 exposes `signedOut` so the board can `router.replace("/signin")`.
 */

/** Headroom kept above the page size when merging a poll into the board. */
export const LIVE_MERGE_BUFFER = 5;

/** A failed poll that kept the last good data. */
export interface LiveBoardError {
  readonly message: string;
  /** `true` when another poll may succeed (network/5xx), `false` for auth. */
  readonly retryable: boolean;
}

/** Options accepted by {@link useLiveBoard}. */
export interface UseLiveBoardOptions {
  /** Poll interval; defaults to {@link BOARD_POLL_INTERVAL_MS} (15000ms). */
  readonly intervalMs?: number;
  /** Board page size; defaults to {@link KUDOS_PAGE_SIZE} (20, constraint C-3). */
  readonly pageSize?: number;
  /** Items kept beyond the page size after a merge; defaults to {@link LIVE_MERGE_BUFFER}. */
  readonly buffer?: number;
  /** Set `false` to stop polling entirely (e.g. while viewing page 2+). */
  readonly enabled?: boolean;
}

/** Result of {@link useLiveBoard}. */
export interface UseLiveBoardResult {
  /** Newest-first merged board list (page size + buffer at most). */
  readonly kudos: Kudos[];
  /**
   * `true` only while a poll request is in flight. Deliberately *not* a list
   * loading state: `kudos` always holds the last rendered data.
   */
  readonly isSyncing: boolean;
  /** Wall-clock time of the last successful merge, or `null` before the first. */
  readonly lastMergedAt: Date | null;
  /** Kudos that arrived in the most recent merge and were not on the board before. */
  readonly newArrivals: Kudos[];
  /** Last poll failure, if any; the board keeps its last good data meanwhile. */
  readonly error: LiveBoardError | null;
  /**
   * `true` once a poll returned 401 — the session cookie is missing or invalid
   * and the board should redirect to `/signin`.
   */
  readonly signedOut: boolean;
  /** Triggers an immediate poll (used by the error state's "Try again"). */
  readonly retry: () => void;
}

/** Sorts newest first: `createdAt` desc, then `id` desc as the stable tiebreak (ADR-6). */
export function compareKudosNewestFirst(a: Kudos, b: Kudos): number {
  const at = Date.parse(a.createdAt) || 0;
  const bt = Date.parse(b.createdAt) || 0;
  if (bt !== at) {
    return bt - at;
  }
  return String(b.id).localeCompare(String(a.id));
}

/**
 * Reads the kudos array out of a `GET /api/v1/kudos` payload, accepting either
 * the paginated envelope (`{ data, page, pageSize, total }`) or a bare array.
 */
export function readKudosPage(payload: KudosPage | Kudos[]): Kudos[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
}

/** Result of {@link mergeKudos}. */
export interface MergeKudosResult {
  /** Merged, sorted, capped list. */
  readonly items: Kudos[];
  /** The previously-unseen kudos that actually survived the cap. */
  readonly arrivals: Kudos[];
}

/**
 * Merges a polled page into the current board list.
 *
 * - Dedupes on `id`; the incoming item wins so reaction counts and `mine` flags
 *   refresh without duplicating a card.
 * - Sorts `createdAt` desc with `id` desc as the stable tiebreak (ADR-6).
 * - Caps the merged list at `cap` (page size + buffer), keeping the newest.
 */
export function mergeKudos(
  current: Kudos[],
  incoming: Kudos[],
  cap: number,
): MergeKudosResult {
  const byId = new Map<string, Kudos>();
  for (const item of current) {
    if (item) {
      byId.set(item.id, item);
    }
  }

  const fresh: Kudos[] = [];
  for (const item of incoming) {
    if (!item) {
      continue;
    }
    if (!byId.has(item.id)) {
      fresh.push(item);
    }
    byId.set(item.id, item);
  }

  const limit = Math.max(cap, 0);
  const items = Array.from(byId.values())
    .sort(compareKudosNewestFirst)
    .slice(0, limit);

  const kept = new Set(items.map((item) => item.id));
  return { items, arrivals: fresh.filter((item) => kept.has(item.id)) };
}

/**
 * Keeps the newest-first board list live with a 15s page-1 poll (ADR-3).
 *
 * See the module comment for the full contract.
 */
export function useLiveBoard(
  initialKudos: Kudos[],
  options: UseLiveBoardOptions = {},
): UseLiveBoardResult {
  const {
    intervalMs = BOARD_POLL_INTERVAL_MS,
    pageSize = KUDOS_PAGE_SIZE,
    buffer = LIVE_MERGE_BUFFER,
    enabled = true,
  } = options;

  // Never shrink below the server-rendered seed, whatever the cap is.
  const cap = useMemo(
    () => Math.max(pageSize + buffer, initialKudos.length),
    [pageSize, buffer, initialKudos.length],
  );

  const [kudos, setKudos] = useState<Kudos[]>(initialKudos);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastMergedAt, setLastMergedAt] = useState<Date | null>(null);
  const [newArrivals, setNewArrivals] = useState<Kudos[]>([]);
  const [error, setError] = useState<LiveBoardError | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [isTabVisible, setIsTabVisible] = useState<boolean>(() =>
    typeof document === "undefined"
      ? true
      : document.visibilityState !== "hidden",
  );

  const kudosRef = useRef<Kudos[]>(initialKudos);
  const inFlightRef = useRef(false);

  const poll = useCallback(async (): Promise<void> => {
    // ADR-3: never poll while the tab is hidden.
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    // Skip overlapping ticks; the board keeps rendering while a poll runs.
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setIsSyncing(true);
    try {
      const payload = await getKudosPage(1);
      const { items, arrivals } = mergeKudos(
        kudosRef.current,
        readKudosPage(payload),
        cap,
      );
      kudosRef.current = items;
      setKudos(items);
      setNewArrivals(arrivals);
      setLastMergedAt(new Date());
      setError(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.isUnauthenticated) {
        // Session gone: signal the board to redirect to /signin.
        setSignedOut(true);
        setError({ message: "Please sign in again.", retryable: false });
      } else {
        setError({
          message:
            cause instanceof Error && cause.message.length > 0
              ? cause.message
              : "Couldn't update the board.",
          retryable: true,
        });
      }
      // Intentionally leave `kudos` untouched — the last good data stays up.
    } finally {
      inFlightRef.current = false;
      setIsSyncing(false);
    }
  }, [cap]);

  // The 15s interval exists only while polling is possible: enabled, signed in
  // and tab visible. Tearing it down is what pauses polling on hidden tabs.
  useEffect(() => {
    if (!enabled || signedOut || !isTabVisible) {
      return undefined;
    }
    const id = window.setInterval(() => {
      void poll();
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [enabled, signedOut, isTabVisible, intervalMs, poll]);

  // Pause on hidden, catch up the moment the tab becomes visible again.
  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }
    const handleVisibilityChange = (): void => {
      const visible = document.visibilityState !== "hidden";
      setIsTabVisible(visible);
      if (visible) {
        void poll();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [poll]);

  const retry = useCallback(() => {
    void poll();
  }, [poll]);

  return {
    kudos,
    isSyncing,
    lastMergedAt,
    newArrivals,
    error,
    signedOut,
    retry,
  };
}

export default useLiveBoard;
