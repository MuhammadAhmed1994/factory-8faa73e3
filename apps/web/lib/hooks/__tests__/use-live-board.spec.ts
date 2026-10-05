/**
 * `useLiveBoard` — the 15s poll that keeps the open board live (AC-13, ADR-3).
 *
 * The polling engine (`createLiveBoardStore`) is exercised directly so the spec
 * needs no DOM at all: fake timers advance the clock by exactly one 15000ms
 * interval and a mocked `global.fetch` (what the shared api client calls)
 * resolves the page-1 response. Tab visibility is faked through the store's
 * pluggable `VisibilitySource`, which is the same seam the production hook uses
 * for `document.visibilityState`.
 */

import { ApiError } from "@/lib/api-client";
import {
  DEFAULT_POLL_INTERVAL_MS,
  MERGE_BUFFER,
  createLiveBoardStore,
  type VisibilitySource,
} from "@/lib/hooks/use-live-board";
import type { Kudos, KudosPage } from "@/lib/api-client";

/** One kudos row, with per-test overrides. */
function makeKudos(overrides: Partial<Kudos> & { id: string }): Kudos {
  return {
    recipient: "Priya N.",
    message: "Shipped the migration on a Friday and nothing caught fire.",
    author: { id: "author-1", email: "maya@team.co" },
    createdAt: "2024-05-01T12:00:00.000Z",
    reactions: [{ emoji: "🎉", count: 2, mine: false }],
    ...overrides,
  };
}

/** `GET /api/v1/kudos?page=1` response body. */
function makePage(items: readonly Kudos[]): KudosPage {
  return { items, page: 1, pageSize: items.length, total: items.length };
}

/** A `Response` for the mocked `fetch`. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * Visibility source whose state the test controls, standing in for the Page
 * Visibility API (`document.visibilityState` + `visibilitychange`).
 */
function fakeVisibility(initiallyVisible = true): VisibilitySource & {
  setVisible(visible: boolean): void;
} {
  const listeners = new Set<() => void>();
  let visible = initiallyVisible;
  return {
    isVisible: () => visible,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setVisible(next) {
      visible = next;
      // The Page Visibility API fires exactly this event on a change.
      for (const listener of listeners) listener();
    },
  };
}

/** Advances the clock by one poll interval and flushes the mocked fetch. */
async function advanceOnePoll(): Promise<void> {
  jest.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS);
  // Flush the fetch promise → apiFetch's parse → the store's state update.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useLiveBoard", () => {
  const initial = [
    makeKudos({ id: "k-1", createdAt: "2024-05-01T12:00:00.000Z" }),
    makeKudos({ id: "k-2", createdAt: "2024-05-01T11:00:00.000Z" }),
  ];

  let visibility: ReturnType<typeof fakeVisibility>;

  beforeEach(() => {
    jest.useFakeTimers();
    visibility = fakeVisibility(true);
    // Recreated per test so call counts stay per-test.
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("[AC-13] merges a kudos posted from another session into the open board within 15s without a reload", async () => {
    const fromOtherSession = makeKudos({
      id: "k-999",
      recipient: "Ari K.",
      createdAt: "2024-05-01T12:05:00.000Z", // newer than everything on board
    });

    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(makePage([...initial, fromOtherSession])),
    );

    const store = createLiveBoardStore(initial, { visibility });
    store.start();

    // Fresh board: the server-rendered page is already on screen, no fetch yet.
    expect(store.getSnapshot().kudos.map((k) => k.id)).toEqual(["k-1", "k-2"]);
    expect(global.fetch).not.toHaveBeenCalled();

    await advanceOnePoll();

    // 15 seconds later the colleague's kudos is on the open board, on top,
    // with no reload and no manual action from this member.
    expect(store.getSnapshot().kudos.map((k) => k.id)).toEqual([
      "k-999",
      "k-1",
      "k-2",
    ]);
    expect(store.getSnapshot().kudos[0]).toEqual(fromOtherSession);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain("/kudos");
    expect(calledUrl).toContain("page=1");

    // The merge is reported so the board can announce and highlight the arrival.
    expect(store.getSnapshot().newArrivals.map((k) => k.id)).toEqual(["k-999"]);
    expect(store.getSnapshot().lastMergedAt).not.toBeNull();
  });

  it("does not poll and does not fetch while the tab is hidden", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(makePage(initial)));

    const store = createLiveBoardStore(initial, { visibility });
    store.start();

    // Hide the tab before the first tick fires.
    visibility.setVisible(false);
    await advanceOnePoll();
    expect(global.fetch).not.toHaveBeenCalled();

    // Still hidden: a full second interval passes with no request either.
    await advanceOnePoll();
    expect(global.fetch).not.toHaveBeenCalled();

    // The list is untouched while hidden — no loading state was entered.
    expect(store.getSnapshot().isSyncing).toBe(false);
    expect(store.getSnapshot().kudos.map((k) => k.id)).toEqual(["k-1", "k-2"]);
  });

  it("does not flip into a loading state between ticks — the list stays rendered while syncing", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    (global.fetch as jest.Mock).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const store = createLiveBoardStore(initial, { visibility });
    store.start();
    expect(store.getSnapshot().isSyncing).toBe(false);

    jest.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS);

    // The poll is in flight: syncing is true, yet the list is fully rendered.
    expect(store.getSnapshot().isSyncing).toBe(true);
    expect(store.getSnapshot().kudos.map((k) => k.id)).toEqual(["k-1", "k-2"]);

    resolveFetch?.(jsonResponse(makePage(initial)));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getSnapshot().isSyncing).toBe(false);
    expect(store.getSnapshot().kudos.map((k) => k.id)).toEqual(["k-1", "k-2"]);
  });

  it("dedupes by id on merge — an updated copy replaces the stale row instead of duplicating it", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(
        makePage([
          // Same ids as on the board, but a reaction count moved 2 → 3.
          makeKudos({
            id: "k-1",
            createdAt: "2024-05-01T12:00:00.000Z",
            reactions: [{ emoji: "🎉", count: 3, mine: false }],
          }),
          makeKudos({ id: "k-2", createdAt: "2024-05-01T11:00:00.000Z" }),
        ]),
      ),
    );

    const store = createLiveBoardStore(initial, { visibility });
    store.start();

    await advanceOnePoll();

    const state = store.getSnapshot();
    expect(state.kudos.map((k) => k.id)).toEqual(["k-1", "k-2"]);
    // The polled copy replaced the stale one; nothing was duplicated.
    expect(state.kudos[0].reactions[0].count).toBe(3);
    expect(state.newArrivals).toEqual([]);
  });

  it("sorts a merged arrival to the top using createdAt desc with id desc as the tiebreak", async () => {
    const sameSecondOlder = makeKudos({
      id: "k-1", // smaller id loses the tiebreak
      createdAt: "2024-05-01T12:00:00.000Z",
    });
    const sameSecondNewer = makeKudos({
      id: "k-500", // larger id wins the tiebreak
      createdAt: "2024-05-01T12:00:00.000Z",
    });

    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(makePage([sameSecondNewer, sameSecondOlder])),
    );

    const store = createLiveBoardStore([sameSecondOlder], { visibility });
    store.start();

    await advanceOnePoll();

    expect(store.getSnapshot().kudos.map((k) => k.id)).toEqual(["k-500", "k-1"]);
  });

  it("caps the merged list at the current page size plus a buffer", async () => {
    // A fetched page claiming far more rows than a page-1 poll should keep.
    const oversized = Array.from({ length: 40 }, (_, index) =>
      makeKudos({
        id: `k-${String(index + 100).padStart(3, "0")}`,
        createdAt: `2024-05-01T13:${String(index).padStart(2, "0")}:00.000Z`,
      }),
    );

    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(makePage(oversized)),
    );

    const store = createLiveBoardStore(initial, { visibility });
    store.start();

    await advanceOnePoll();

    // initial (2) + buffer (5) is the cap; the merge never keeps all 40.
    expect(store.getSnapshot().kudos).toHaveLength(2 + MERGE_BUFFER);
  });

  it("keeps the last good data and exposes a retryable error when a poll fails", async () => {
    const store = createLiveBoardStore(initial, { visibility });
    store.start();

    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new ApiError(500, ["Couldn't refresh the board."]),
    );

    await advanceOnePoll();

    expect(store.getSnapshot().error).toBeInstanceOf(Error);
    expect(store.getSnapshot().signedOut).toBe(false);
    // The board keeps rendering the last good data during the outage.
    expect(store.getSnapshot().kudos.map((k) => k.id)).toEqual(["k-1", "k-2"]);

    // The state is retryable: the next tick succeeds and clears the error.
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(makePage(initial)),
    );
    await advanceOnePoll();
    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().kudos.map((k) => k.id)).toEqual(["k-1", "k-2"]);
  });

  it("exposes signedOut on a 401 so the board can redirect to /signin", async () => {
    const store = createLiveBoardStore(initial, { visibility });
    store.start();

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse({ statusCode: 401, message: "Unauthorized" }, 401),
    );

    await advanceOnePoll();

    // The board reads this flag and routes the member to /signin.
    expect(store.getSnapshot().signedOut).toBe(true);
    expect(store.getSnapshot().error).toBeInstanceOf(ApiError);
    // The list is not cleared out from under the member mid-redirect.
    expect(store.getSnapshot().kudos.length).toBeGreaterThan(0);
  });

  it("resumes polling when a hidden tab becomes visible again", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(makePage(initial)));

    const store = createLiveBoardStore(initial, { visibility });
    store.start();

    visibility.setVisible(false);
    await advanceOnePoll();
    expect(global.fetch).not.toHaveBeenCalled();

    visibility.setVisible(true);
    await advanceOnePoll();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps exactly one poll in flight — overlapping ticks do not double-fetch", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    (global.fetch as jest.Mock).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const store = createLiveBoardStore(initial, { visibility });
    store.start();

    // Two ticks land before the first response resolves.
    jest.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS);
    jest.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS);
    await Promise.resolve();

    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveFetch?.(jsonResponse(makePage(initial)));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The next tick after the response settles proceeds normally.
    jest.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
