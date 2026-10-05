import { act, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";

import LiveIndicator from "@/components/board/live-indicator";
import type { Kudos, KudosPage } from "@/lib/api-client";
import { useLiveBoard } from "@/lib/hooks/use-live-board";

/**
 * Specs for the 15s live-board poll (ADR-3 / EP-3 / AC-13).
 *
 * `fetch` is mocked at the network boundary the shared api client uses, and the
 * 15000ms interval is driven by a controlled `window.setInterval` clock that
 * records the armed cadence and lets the spec fire each tick, so these specs
 * assert the real hook behaviour — merge-by-id, sort, cap, pause-while-hidden,
 * error retention and the 401 sign-out signal — without any API server.
 *
 * Why not `jest.useFakeTimers()`? This repo's jsdom test realm *is* the jsdom
 * window (see `jest/jsdom-environment.cjs`), and jest's fake timers do not
 * replace the window's own timer methods there — `jest.getTimerCount()` stays
 * `0` and `advanceTimersByTime` never fires a registered callback (pinned by
 * the sibling `use-live-board-diag.spec.ts`). The controlled clock below is
 * the "advance 15000ms" step expressed reliably against that realm: it proves
 * the hook armed the interval at exactly 15000ms and then fires it once.
 */

/** A `[recipient, id, createdAt]` row of the wall. */
type Row = [string, string, string];

const row = ([recipient, id, createdAt]: Row): Kudos => ({
  id,
  recipient,
  message: `Thank you ${recipient}`,
  author: { id: `author-${id}`, email: "maya@team.co" },
  createdAt,
  reactions: [],
});

const envelope = (rows: Kudos[]): KudosPage => ({
  data: rows,
  page: 1,
  pageSize: rows.length,
  total: rows.length,
});

/** Minimum Response-shaped mock resolved from a JSON body. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "Content-Type": "application/json" }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Installs a fetch mock and returns it for call-count assertions/overrides. */
function installFetch(
  respond: (input: RequestInfo | URL) => Promise<Response>,
): jest.Mock {
  const mock = jest.fn().mockImplementation(respond);
  global.fetch = mock as unknown as typeof global.fetch;
  return mock;
}

function setVisible(visible: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (visible ? "visible" : "hidden"),
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => !visible,
  });
}

/** Drives the hook's poll promise chain to completion inside act(). */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/* ------------------------------------------------------------------ *
 * Controlled interval clock — a stand-in for advancing 15000ms.
 * ------------------------------------------------------------------ */

/** One live interval registered on `window` by the hook. */
interface RegisteredInterval {
  id: number;
  /** Invokes the scheduled callback — the same as advancing past the delay. */
  fire: () => void;
  /** The delay the caller asked for, in ms. */
  delayMs: number;
}

let intervals: RegisteredInterval[];
let nextIntervalId: number;
let realSetInterval: typeof window.setInterval;
let realClearInterval: typeof window.clearInterval;

/** Replaces `window.setInterval`/`clearInterval` with a recording stub. */
function useControlledIntervals(): void {
  intervals = [];
  nextIntervalId = 0;
  realSetInterval = window.setInterval;
  realClearInterval = window.clearInterval;

  window.setInterval = ((handler: TimerHandler, timeout?: number) => {
    nextIntervalId += 1;
    const id = nextIntervalId;
    intervals.push({
      id,
      fire: () => {
        if (typeof handler === "function") {
          handler(undefined);
        }
      },
      delayMs: Number(timeout ?? 0),
    });
    return id as unknown as number;
  }) as unknown as typeof window.setInterval;

  window.clearInterval = ((id?: number) => {
    const numeric = typeof id === "number" ? id : Number(id);
    intervals = intervals.filter((entry) => entry.id !== numeric);
  }) as unknown as typeof window.clearInterval;
}

/** Intervals still armed on the board. */
const armedIntervals = (): RegisteredInterval[] => intervals;

/** Fires every armed tick once — the "advance 15000ms" equivalent. */
async function advanceBoardInterval(): Promise<void> {
  await act(async () => {
    for (const entry of [...intervals]) {
      entry.fire();
    }
  });
}

/* ------------------------------------------------------------------ */

const K1 = row(["Priya N.", "k-1", "2024-06-01T09:00:00.000Z"]);
const K2 = row(["Maya R.", "k-2", "2024-06-01T09:00:20.000Z"]);

let fetchUrls: string[];
let fetch: jest.Mock;

describe("useLiveBoard", () => {
  beforeEach(() => {
    fetchUrls = [];
    setVisible(true);
    useControlledIntervals();
    fetch = installFetch((input) => {
      fetchUrls.push(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      );
      return Promise.resolve(jsonResponse(envelope([K1])));
    });
  });

  afterEach(() => {
    window.setInterval = realSetInterval;
    window.clearInterval = realClearInterval;
  });

  it("[AC-13] merges a kudos posted from another session into the open board within 15s without a reload", async () => {
    const { result } = renderHook(() => useLiveBoard([K1]));

    // Page 1 is server-rendered: no fetch on mount, and the list is never
    // swapped for a loading state between ticks.
    expect(fetch.mock.calls).toHaveLength(0);
    expect(result.current.kudos.map((item) => item.id)).toEqual(["k-1"]);
    expect(result.current.isSyncing).toBe(false);

    // The poll is armed on the 15000ms board cadence (ADR-3).
    expect(armedIntervals()).toHaveLength(1);
    expect(armedIntervals()[0]?.delayMs).toBe(15_000);

    // A colleague posts kudos k-2 from another signed-in session…
    fetch.mockImplementationOnce(() => Promise.resolve(jsonResponse([K2, K1])));

    // …and 15000ms elapse on the already-open board — no page reload.
    await advanceBoardInterval();
    await settle();

    expect(result.current.kudos.map((item) => item.id)).toEqual(["k-2", "k-1"]);
    expect(result.current.kudos[0]?.recipient).toBe("Maya R.");
    expect(result.current.newArrivals.map((item) => item.id)).toEqual(["k-2"]);
    expect(result.current.lastMergedAt).toBeInstanceOf(Date);
    expect(result.current.isSyncing).toBe(false);
    expect(result.current.signedOut).toBe(false);
  });

  it("keeps the board interactive between ticks and never reports a loading state", () => {
    const { result } = renderHook(() => useLiveBoard([K1]));

    expect(result.current.kudos).toHaveLength(1);
    expect(result.current.isSyncing).toBe(false);
    expect(result.current.newArrivals).toEqual([]);
    expect(result.current.lastMergedAt).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("requests GET /api/v1/kudos?page=1 on each visible tick", async () => {
    renderHook(() => useLiveBoard([K1]));

    await advanceBoardInterval();
    await settle();
    expect(fetch.mock.calls).toHaveLength(1);

    await advanceBoardInterval();
    await settle();
    expect(fetch.mock.calls).toHaveLength(2);

    expect(fetchUrls).toEqual([
      "http://localhost:3000/api/v1/kudos?page=1",
      "http://localhost:3000/api/v1/kudos?page=1",
    ]);
  });

  it("pauses polling while document.visibilityState is hidden and catches up when visible", async () => {
    const { result } = renderHook(() => useLiveBoard([K1]));

    // Hide the tab: the interval is cleared, so ticks can no longer fire.
    setVisible(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(armedIntervals()).toHaveLength(0);

    await advanceBoardInterval();
    await settle();
    expect(fetch.mock.calls).toHaveLength(0);

    // Returning to the tab re-arms the interval and polls once immediately.
    setVisible(true);
    fetch.mockImplementationOnce(() => Promise.resolve(jsonResponse([K2, K1])));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();

    expect(fetch.mock.calls).toHaveLength(1);
    expect(armedIntervals()).toHaveLength(1);
    expect(armedIntervals()[0]?.delayMs).toBe(15_000);
    expect(result.current.kudos.map((item) => item.id)).toEqual(["k-2", "k-1"]);
  });

  it("dedupes by id, replacing the existing card instead of duplicating it", async () => {
    const older = row(["Maya R.", "k-2", "2024-06-01T08:00:00.000Z"]);
    const newest = row(["Priya N.", "k-1", "2024-06-01T09:00:00.000Z"]);
    const reacted = {
      ...newest,
      reactions: [{ emoji: "🎉", count: 2, mine: false }],
    };

    fetch = installFetch(() =>
      Promise.resolve(jsonResponse([reacted, { ...older }])),
    );

    const { result } = renderHook(() => useLiveBoard([newest, older]));

    await advanceBoardInterval();
    await settle();

    expect(result.current.kudos.map((item) => item.id)).toEqual([
      "k-1",
      "k-2",
    ]);
    expect(result.current.kudos).toHaveLength(2);
    expect(result.current.newArrivals).toEqual([]);
    expect(result.current.kudos[0]?.reactions).toEqual([
      { emoji: "🎉", count: 2, mine: false },
    ]);
  });

  it("sorts merged kudos newest first with id desc as the stable tiebreak", async () => {
    const initial = [
      row(["A", "k-2", "2024-06-01T09:00:00.000Z"]),
      row(["B", "k-1", "2024-06-01T09:00:00.000Z"]),
    ];
    fetch = installFetch(() =>
      Promise.resolve(
        jsonResponse([
          row(["C", "k-3", "2024-06-01T09:00:10.000Z"]),
          row(["B", "k-1", "2024-06-01T09:00:00.000Z"]),
        ]),
      ),
    );

    const { result } = renderHook(() => useLiveBoard(initial));

    await advanceBoardInterval();
    await settle();

    expect(result.current.kudos.map((item) => item.id)).toEqual([
      "k-3",
      "k-2",
      "k-1",
    ]);
  });

  it("caps the merged list at the page size plus buffer", async () => {
    const seed = Array.from({ length: 20 }, (_, index) =>
      row([
        `Seed ${index}`,
        `k-seed-${String(index).padStart(2, "0")}`,
        new Date(Date.UTC(2024, 5, 1, 8, 0, index)).toISOString(),
      ]),
    );
    const olderPage = Array.from({ length: 20 }, (_, index) =>
      row([
        `Older ${index}`,
        `k-older-${String(index).padStart(2, "0")}`,
        new Date(Date.UTC(2024, 5, 1, 7, 0, index)).toISOString(),
      ]),
    );

    fetch = installFetch(() =>
      Promise.resolve(
        jsonResponse([
          row(["New", "k-new-1", "2024-06-01T10:00:00.000Z"]),
          ...seed,
          ...olderPage,
        ]),
      ),
    );

    const { result } = renderHook(() => useLiveBoard(seed));

    await advanceBoardInterval();
    await settle();

    const ids = result.current.kudos.map((item) => item.id);
    // 20 (page size) + 5 (buffer) = 25 kept of the 41 unique merged kudos.
    expect(ids).toHaveLength(25);
    expect(ids[0]).toBe("k-new-1");
    expect(ids).toContain("k-seed-00");
    expect(ids).toContain("k-older-16");
    // The oldest arrivals fall off the capped window.
    expect(ids).not.toContain("k-older-15");
  });

  it("keeps the last good data with a retryable error when a poll fails", async () => {
    fetch = installFetch(() =>
      Promise.resolve(jsonResponse({ statusCode: 503, message: "Boom" }, 503)),
    );

    const { result } = renderHook(() => useLiveBoard([{ ...K1 }]));

    await advanceBoardInterval();
    await settle();

    expect(result.current.kudos.map((item) => item.id)).toEqual(["k-1"]);
    expect(result.current.error?.retryable).toBe(true);
    expect(result.current.error?.message).toBe("Boom");
    expect(result.current.signedOut).toBe(false);
    expect(result.current.isSyncing).toBe(false);

    // Retryable: a later tick can succeed and clear the error.
    fetch = installFetch(() => Promise.resolve(jsonResponse([K2, K1])));
    await advanceBoardInterval();
    await settle();
    expect(result.current.error).toBeNull();
    expect(result.current.kudos.map((item) => item.id)).toEqual(["k-2", "k-1"]);
  });

  it("exposes signedOut and stops polling when a poll returns 401", async () => {
    fetch = installFetch(() =>
      Promise.resolve(
        jsonResponse({ statusCode: 401, message: "Unauthorized" }, 401),
      ),
    );

    const { result } = renderHook(() => useLiveBoard([{ ...K1 }]));

    await advanceBoardInterval();
    await settle();

    expect(result.current.signedOut).toBe(true);
    expect(result.current.error?.retryable).toBe(false);
    expect(result.current.kudos.map((item) => item.id)).toEqual(["k-1"]);
    expect(fetch.mock.calls).toHaveLength(1);

    // The interval is cleared once signed out, so no further polls fire.
    expect(armedIntervals()).toHaveLength(0);
    await advanceBoardInterval();
    await settle();
    expect(fetch.mock.calls).toHaveLength(1);
  });
});

describe("LiveIndicator", () => {
  it("renders the accent dot with the 'Updates every 15s' caption", () => {
    render(createElement(LiveIndicator));
    const indicator = screen.getByTestId("live-indicator");

    expect(indicator).toHaveTextContent("Updates every 15s");
    // Caption type + colour tokens (muted_foreground #6E655A) come from the
    // shared Tailwind theme mapping in tailwind.config.ts.
    expect(indicator).toHaveClass("type-caption", "text-muted-foreground");

    const dot = indicator.querySelector(".live-indicator__dot");
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("aria-hidden", "true");

    // jsdom cannot resolve CSS custom properties, so the dot's palette
    // (#E8A33D accent) is asserted against the injected token stylesheet.
    const style = document.querySelector("style");
    expect(style?.textContent).toContain(".live-indicator__dot");
    expect(style?.textContent).toContain("background: var(--accent);");
    expect(style?.textContent).toContain("var(--accent-soft)");
  });

  it("reflects the idle, syncing and fresh-arrival states", () => {
    const { rerender } = render(
      createElement(LiveIndicator, { state: "idle" }),
    );
    expect(screen.getByTestId("live-indicator")).toHaveAttribute(
      "data-state",
      "idle",
    );

    rerender(createElement(LiveIndicator, { state: "syncing" }));
    expect(screen.getByTestId("live-indicator")).toHaveAttribute(
      "data-state",
      "syncing",
    );

    rerender(createElement(LiveIndicator, { state: "fresh-arrival" }));
    expect(screen.getByTestId("live-indicator")).toHaveAttribute(
      "data-state",
      "fresh-arrival",
    );
  });

  it("pulses the dot once per merge and collapses to a 200ms fade under reduced motion", () => {
    const { rerender } = render(
      createElement(LiveIndicator, { pulseAt: 1_000 }),
    );
    const first = screen
      .getByTestId("live-indicator")
      .querySelector(".live-indicator__dot");
    expect(first).toHaveAttribute("data-pulse", "true");

    rerender(createElement(LiveIndicator, { pulseAt: 2_000 }));
    const second = screen
      .getByTestId("live-indicator")
      .querySelector(".live-indicator__dot");
    expect(second).toHaveAttribute("data-pulse", "true");
    // Re-keyed, so the one-shot pulse animation replays on every merge.
    expect(second).not.toBe(first);

    const style = document.querySelector("style");
    expect(style?.textContent).toContain("320ms");
    expect(style?.textContent).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*200ms/,
    );
  });
});
