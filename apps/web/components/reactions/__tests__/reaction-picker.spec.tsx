import { act, fireEvent, render, screen } from "@testing-library/react";

import ReactionPicker from "@/components/reactions/reaction-picker";
import { Toaster } from "@/components/ui/toaster";
import type { Kudos, ReactionSummary } from "@/lib/api/types";

/**
 * [AC-14] / [AC-15] — the reaction picker's two halves of US-4.
 *
 * `global.fetch` is stubbed rather than `setReaction`, so every assertion about
 * "PUTs /kudos/:id/reactions" travels the real path
 * `ReactionPicker → setReaction → fetch`: evidence about EP-5, not a mock.
 * Responses are deferred by hand so each optimistic phase is observable before
 * the 2xx reconciles it. Exactly one `it()` per AC id, per the task rules.
 */

const KUDOS_ID = "kudos-1";
const TADA = "React 🎉 — party popper";
const HANDS = "React 🙌 — raised hands";

function kudosWith(reactions: ReactionSummary[]): Kudos {
  return {
    id: KUDOS_ID,
    recipient: "priya@team.co",
    message: "Shipped the migration on a Friday and nothing caught fire.",
    author: { id: "member-1", email: "maya@team.co" },
    createdAt: "2024-05-01T10:00:00.000Z",
    reactions,
  };
}

const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(body)) }) as unknown as Response;

function deferredFetch() {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  const pending: Array<(r: Response) => void> = [];
  fetchMock.mockImplementation(
    () => new Promise<Response>((resolve) => pending.push(resolve)),
  );
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  const settle = async (body: Kudos): Promise<void> => {
    const resolve = pending.shift();
    if (!resolve) throw new Error("no fetch in flight");
    await act(async () => {
      resolve(ok(body));
      await Promise.resolve();
    });
  };
  return { fetchMock, settle };
}

const chips = (): HTMLElement[] =>
  screen.getAllByTestId("reaction-chip") as HTMLElement[];

const mine = (): HTMLElement[] =>
  chips().filter((c) => c.dataset.mine === "true");

const trigger = (): HTMLElement => screen.getByTestId("reaction-trigger");

async function pick(label: string): Promise<void> {
  await act(async () => {
    fireEvent.click(trigger());
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitemradio", { name: label }));
  });
}

afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = undefined;
});

describe("[AC-14] ReactionPicker first reaction", () => {
  it("[AC-14] picking an emoji PUTs /kudos/:id/reactions and the chip row shows that reaction at count 1 with the mine pill", async () => {
    const { fetchMock, settle } = deferredFetch();
    render(
      <>
        <ReactionPicker kudos={kudosWith([])} />
        <Toaster />
      </>,
    );
    await act(async () => {
      fireEvent.click(trigger());
    });
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(4);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: TADA }));
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toBe(`/api/v1/kudos/${KUDOS_ID}/reactions`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ emoji: "🎉" });
    await settle(kudosWith([{ emoji: "🎉", count: 1, mine: true }]));
    expect(chips()).toHaveLength(1);
    expect(mine()).toHaveLength(1);
  });
});

describe("[AC-15] ReactionPicker replace semantics", () => {
  it("[AC-15] reacting again with a different emoji replaces the previous reaction — exactly one mine pill, never duplicated", async () => {
    const { fetchMock, settle } = deferredFetch();
    render(
      <>
        <ReactionPicker
          kudos={kudosWith([
            { emoji: "❤️", count: 2, mine: true },
            { emoji: "👍", count: 1, mine: false },
          ])}
        />
        <Toaster />
      </>,
    );
    await pick(TADA);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      emoji: "🎉",
    });
    await settle(
      kudosWith([
        { emoji: "🎉", count: 2, mine: true },
        { emoji: "❤️", count: 1, mine: false },
        { emoji: "👍", count: 1, mine: false },
      ]),
    );
    await pick(HANDS);
    await settle(
      kudosWith([
        { emoji: "🙌", count: 2, mine: true },
        { emoji: "🎉", count: 1, mine: false },
        { emoji: "❤️", count: 1, mine: false },
        { emoji: "👍", count: 1, mine: false },
      ]),
    );
    expect(mine()).toHaveLength(1);
    expect(chips()).toHaveLength(4);
  });
});
