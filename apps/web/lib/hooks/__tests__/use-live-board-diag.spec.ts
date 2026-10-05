import {
  compareKudosNewestFirst,
  mergeKudos,
  readKudosPage,
  LIVE_MERGE_BUFFER,
} from "@/lib/hooks/use-live-board";
import type { Kudos } from "@/lib/api-client";

/**
 * Pure-function unit specs for the live-board merge (ADR-6).
 *
 * These cover the merge/sort/dedupe/cap logic directly, independent of React
 * and of the test realm's timers — a companion to the hook-level specs in
 * `use-live-board.spec.ts`, which drive the 15000ms cadence through a
 * controlled `window.setInterval` clock.
 *
 * Note on `jest.useFakeTimers()`: this repo's jsdom environment
 * (`jest/jsdom-environment.cjs`) makes the jsdom window the test realm, and
 * jest's fake timers do not replace the window's own timer methods there —
 * `jest.getTimerCount()` stays `0` and `advanceTimersByTime` never fires.
 * Hook specs therefore stub `window.setInterval` instead of relying on fakes.
 */

const item = (id: string, createdAt: string): Kudos => ({
  id,
  recipient: `Recipient ${id}`,
  message: `Thank you ${id}`,
  author: { id: `author-${id}`, email: "maya@team.co" },
  createdAt,
  reactions: [],
});

describe("compareKudosNewestFirst", () => {
  it("orders by createdAt descending", () => {
    const older = item("k-1", "2024-06-01T09:00:00.000Z");
    const newer = item("k-2", "2024-06-01T09:00:20.000Z");
    expect([older, newer].sort(compareKudosNewestFirst)).toEqual([
      newer,
      older,
    ]);
  });

  it("breaks createdAt ties with id descending for a stable order", () => {
    const same = "2024-06-01T09:00:00.000Z";
    const low = item("k-1", same);
    const high = item("k-2", same);
    expect([low, high].sort(compareKudosNewestFirst)).toEqual([high, low]);
    // Stable: the same input always yields the same output.
    expect([high, low].sort(compareKudosNewestFirst)).toEqual([high, low]);
  });
});

describe("readKudosPage", () => {
  it("reads the data array out of the paginated envelope", () => {
    const rows = [item("k-1", "2024-06-01T09:00:00.000Z")];
    expect(readKudosPage({ data: rows, page: 1, pageSize: 20, total: 1 })).toBe(
      rows,
    );
  });

  it("accepts a bare kudos array as well", () => {
    const rows = [item("k-1", "2024-06-01T09:00:00.000Z")];
    expect(readKudosPage(rows)).toBe(rows);
  });

  it("returns an empty list for an unusable payload", () => {
    expect(readKudosPage({} as never)).toEqual([]);
  });
});

describe("mergeKudos", () => {
  it("keeps the incoming copy when an id already exists", () => {
    const current = [item("k-1", "2024-06-01T09:00:00.000Z")];
    const refreshed = {
      ...item("k-1", "2024-06-01T09:00:00.000Z"),
      reactions: [{ emoji: "🎉", count: 3, mine: false }],
    };

    const { items, arrivals } = mergeKudos(current, [refreshed], 25);

    expect(items).toHaveLength(1);
    expect(items[0]?.reactions).toEqual([{ emoji: "🎉", count: 3, mine: false }]);
    expect(arrivals).toEqual([]);
  });

  it("reports genuinely new ids as arrivals and keeps them newest-first", () => {
    const current = [item("k-1", "2024-06-01T09:00:00.000Z")];
    const arrival = item("k-2", "2024-06-01T09:00:20.000Z");

    const { items, arrivals } = mergeKudos(current, [arrival, ...current], 25);

    expect(items.map((entry) => entry.id)).toEqual(["k-2", "k-1"]);
    expect(arrivals.map((entry) => entry.id)).toEqual(["k-2"]);
  });

  it("caps the merged list at the requested size, dropping the oldest", () => {
    const current = Array.from({ length: 10 }, (_, index) =>
      item(`k-current-${index}`, `2024-06-01T08:00:${String(index).padStart(2, "0")}.000Z`),
    );
    const incoming = Array.from({ length: 10 }, (_, index) =>
      item(`k-new-${index}`, `2024-06-01T09:00:${String(index).padStart(2, "0")}.000Z`),
    );

    const { items, arrivals } = mergeKudos(current, incoming, 15);

    expect(items).toHaveLength(15);
    expect(items[0]?.id).toBe("k-new-9");
    expect(items[14]?.id).toBe("k-current-5");
    // Only the arrivals that survived the cap are reported.
    expect(arrivals).toHaveLength(10);
  });

  it("uses a page-size-plus-5 buffer by default", () => {
    expect(LIVE_MERGE_BUFFER).toBe(5);
  });
});
