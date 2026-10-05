"use client";

/**
 * Live board polling (ADR-3 — AC-13).
 *
 * Board liveness is plain 15-second polling of `GET /api/v1/kudos?page=1`
 * (EP-3) through the shared api client; no SSE, no WebSocket, no long-poll
 * channel exists on the API. The board page hands page 1 in as
 * `initialKudos` — server-rendered, so the first paint never shows a skeleton.
 *
 * The engine lives in {@link createLiveBoardStore}, a small framework-free
 * store that owns the interval, the visibility gating and the merge. The React
 * surface ({@link useLiveBoard}) is a thin `useSyncExternalStore` adapter over
 * it, which keeps the client island minimal and makes the polling behaviour
 * testable without a DOM.
 *
 * Behaviour contract:
 *
 * - Polls every {@link DEFAULT_POLL_INTERVAL_MS} **only** while the tab is
 *   visible; the interval is torn down when the tab is hidden (so a hidden tab
 *   performs no polls at all) and re-armed when it becomes visible again.
 * - Never flips the list into a loading state between ticks — `isSyncing`
 *   annotates a background refresh and the last good `kudos` stays rendered,
 *   so the board stays interactive during polls.
 * - Merges each fetched page into the current list by deduping on `id`, sorting
 *   by `createdAt` desc with `id` desc as the stable tiebreak (ADR-6), and
 *   capping the merged list at the current page size plus a buffer so a stale
 *   page-2 tail cannot accumulate.
 * - On a fetch error the last good data is kept and a retryable `error` is
 *   exposed; a 401 additionally raises `signedOut` so the board can route the
 *   member to `/signin`.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { apiGet, isApiError, type Kudos, type KudosPage } from "@/lib/api-client";

/** The polling cadence, in milliseconds (ADR-3). */
export const DEFAULT_POLL_INTERVAL_MS = 15_000;

/** Fixed board page size: 20 kudos per page (ADR-6). */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * How many extra items the merged list may hold beyond the current page size.
 * The poll only ever fetches page 1, so the cap is a safety net: without it a
 * list first rendered from page 2+ could keep every item it ever saw.
 */
export const MERGE_BUFFER = 5;

/** Copy shown when a poll fails; the board keeps the last good data. */
export const BOARD_SYNC_ERROR_MESSAGE = "Couldn't refresh the board.";

/** Parses `createdAt`, treating an unparseable value as epoch 0. */
function toMillis(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Newest first: `createdAt` desc, `id` desc as the stable tiebreak (ADR-6). */
export function compareKudosNewestFirst(a: Kudos, b: Kudos): number {
  const difference = toMillis(b.createdAt) - toMillis(a.createdAt);
  if (difference !== 0) return difference;
  if (a.id > b.id) return -1;
  if (a.id < b.id) return 1;
  return 0;
}

/**
 * Merges a fetched page into the current list.
 *
 * Later occurrences win (`Map.set` overwrites), so a polled row replaces the
 * stale copy of the same kudos — reaction counts updated by another session's
 * reaction converge too, not just new arrivals.
 */
export function mergeKudosPages(
  current: readonly Kudos[],
  fetched: readonly Kudos[],
  limit: number,
): Kudos[] {
  const byId = new Map<string, Kudos>();
  for (const item of current) byId.set(item.id, item);
  for (const item of fetched) byId.set(item.id, item);

  const merged = [...byId.values()].sort(compareKudosNewestFirst);
  return limit > 0 ? merged.slice(0, limit) : merged;
}

/** Snapshot of the live board, as rendered by the board client island. */
export interface LiveBoardState {
  /** The merged, newest-first board list to render. */
  readonly kudos: readonly Kudos[];
  /**
   * True only while a background poll is in flight. This is *not* a loading
   * state: `kudos` keeps the last good data so the board stays interactive.
   */
  readonly isSyncing: boolean;
  /** Wall-clock time of the last successful poll merge, or `null` before one. */
  readonly lastMergedAt: Date | null;
  /**
   * Kudos merged by the most recent poll that were not on the board before it,
   * newest first. Refreshed on every poll — empty means "nothing new".
   */
  readonly newArrivals: readonly Kudos[];
  /**
   * Retryable sync failure. The list above is the last good data, so the board
   * keeps rendering it; the LiveIndicator and a "try again" affordance surface
   * the failure instead.
   */
  readonly error: Error | null;
  /** True once the API answered 401 — the caller should go to `/signin`. */
  readonly signedOut: boolean;
  /** Runs one poll now (the error state's "Try again" affordance). */
  readonly retry: () => void;
}

/**
 * Pluggable tab-visibility source.
 *
 * The default ({@link documentVisibility}) reads `document.visibilityState` and
 * listens for `visibilitychange`; tests substitute a controllable fake. Kept as
 * an interface so the polling engine never touches a DOM global directly.
 */
export interface VisibilitySource {
  /** True while the tab is the foreground one. */
  isVisible(): boolean;
  /** Subscribes to visibility changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Production visibility source: the Page Visibility API. */
export const documentVisibility: VisibilitySource = {
  isVisible: () =>
    typeof document !== "undefined" && document.visibilityState === "visible",
  subscribe(listener) {
    if (typeof document === "undefined") return () => undefined;
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

/** Options accepted by {@link createLiveBoardStore} and {@link useLiveBoard}. */
export interface UseLiveBoardOptions {
  /** Poll cadence; defaults to {@link DEFAULT_POLL_INTERVAL_MS}. */
  readonly intervalMs?: number;
  /** Per-call API base URL override forwarded to the shared api client. */
  readonly baseUrl?: string;
  /** Merged-list cap override; defaults to the initial page size + buffer. */
  readonly mergeLimit?: number;
  /** Visibility source override; defaults to {@link documentVisibility}. */
  readonly visibility?: VisibilitySource;
}

/** The framework-free polling store behind {@link useLiveBoard}. */
export interface LiveBoardStore {
  /** `useSyncExternalStore` subscription; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Current snapshot; the object identity changes only when state changes. */
  getSnapshot(): LiveBoardState;
  /** Arms the poll and starts observing visibility. Idempotent. */
  start(): void;
  /** Tears the interval down and stops observing visibility. Idempotent. */
  stop(): void;
}

/**
 * Builds the live-board engine: a 15s page-1 poll, gated on tab visibility,
 * whose results are merged into the current list by id.
 *
 * The interval only exists while the tab is visible — hiding the tab clears it,
 * so no request is made in the background, and returning to the tab re-arms it.
 */
export function createLiveBoardStore(
  initialKudos: readonly Kudos[],
  {
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    baseUrl,
    mergeLimit,
    visibility = documentVisibility,
  }: UseLiveBoardOptions = {},
): LiveBoardStore {
  const cap =
    mergeLimit ??
    (initialKudos.length > 0
      ? initialKudos.length + MERGE_BUFFER
      : DEFAULT_PAGE_SIZE + MERGE_BUFFER);

  const listeners = new Set<() => void>();

  let state: LiveBoardState = {
    kudos: [...initialKudos].sort(compareKudosNewestFirst),
    isSyncing: false,
    lastMergedAt: null,
    newArrivals: [],
    error: null,
    signedOut: false,
    retry: () => {
      void poll();
    },
  };

  let timerId: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let running = false;
  let unsubscribeVisibility: (() => void) | null = null;

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const setState = (patch: Partial<LiveBoardState>): void => {
    state = { ...state, ...patch };
    emit();
  };

  const disarm = (): void => {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  const arm = (): void => {
    if (running && timerId === null && visibility.isVisible()) {
      timerId = setInterval(() => {
        void poll();
      }, intervalMs);
    }
  };

  async function poll(): Promise<void> {
    // Never overlap polls, and never poll a tab nobody is looking at.
    if (inFlight || !visibility.isVisible()) return;
    inFlight = true;
    setState({ isSyncing: true });

    let page: KudosPage | null = null;
    try {
      page = await apiGet<KudosPage>("/kudos?page=1", {
        ...(baseUrl !== undefined ? { baseUrl } : {}),
      });
    } catch (thrown) {
      inFlight = false;
      if (isApiError(thrown)) {
        setState({
          isSyncing: false,
          error: thrown,
          ...(thrown.isUnauthorized ? { signedOut: true } : {}),
        });
      } else if (thrown instanceof Error) {
        setState({ isSyncing: false, error: thrown });
      } else {
        setState({ isSyncing: false, error: new Error(BOARD_SYNC_ERROR_MESSAGE) });
      }
      return; // the last good list stays rendered
    }

    const previous = state.kudos;
    const fetched = Array.isArray(page.items) ? page.items : [];
    // Hard cap at page size + buffer; a real page 1 returns at most 20 rows.
    const merged = mergeKudosPages(previous, fetched, cap);
    const seenBefore = new Set(previous.map((item) => item.id));
    const arrivals = merged.filter((item) => !seenBefore.has(item.id));

    inFlight = false;
    setState({
      kudos: merged,
      newArrivals: arrivals,
      lastMergedAt: new Date(),
      error: null,
      isSyncing: false,
    });
  }

  const onVisibilityChange = (): void => {
    if (visibility.isVisible()) arm();
    else disarm();
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): LiveBoardState {
      return state;
    },

    start(): void {
      if (running) return;
      running = true;
      unsubscribeVisibility = visibility.subscribe(onVisibilityChange);
      arm();
    },

    stop(): void {
      running = false;
      disarm();
      unsubscribeVisibility?.();
      unsubscribeVisibility = null;
    },
  };
}

/**
 * Keeps the open board live (AC-13): every 15s, while the tab is visible, page
 * 1 is refetched and merged by id, so a kudos posted from another signed-in
 * session appears at the top of the open board within ~15s — no manual reload,
 * and no loading flash to interrupt whoever is reading it. Polling only; no
 * SSE/WebSocket (ADR-3).
 *
 * `initialKudos` and `options` are read on the first render only, matching how
 * the board page passes its server-fetched page 1 down.
 */
export function useLiveBoard(
  initialKudos: readonly Kudos[],
  options: UseLiveBoardOptions = {},
): LiveBoardState {
  const [store] = useState(() => createLiveBoardStore(initialKudos, options));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store],
  );
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

export default useLiveBoard;
