import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import BoardClient from "@/components/board/board-client";
import { Toaster } from "@/components/ui/toaster";
import {
  KUDOS_PAGE_SIZE,
  type Kudos,
  type KudosPage,
  type SessionMember,
} from "@/lib/api-client";

/**
 * Board specs for the board page (scr-board / scr-board-lead).
 *
 * One `it()` block per AC id, with only that id in the title:
 *
 * - `[AC-7]`  submitting the composer prepends the created kudos to the top of
 *             the list showing recipient, message and author.
 * - `[AC-12]` page 1 renders the 20 newest kudos (recipient, message, author,
 *             reaction counts) and the pagination control loads the next 20 on
 *             page 2.
 * - `[AC-13]` a kudos fetched by the 15s poll (posted from another session)
 *             appears on the open board with no manual reload.
 *
 * The network boundary is `global.fetch` — the calls travel the real path
 * `BoardClient → lib/api/* → apiFetch → fetch`, so assertions about URLs,
 * methods and bodies are evidence about EP-3 / EP-4 / EP-5 / EP-6.
 *
 * `next/navigation` is mocked the same way the sign-in specs mock it: the App
 * Router only exists inside a real Next.js runtime.
 *
 * Timers: the useLiveBoard specs already establish that this repo's jsdom realm
 * (where the window *is* the test realm) does not take jest fake timers for
 * `window.setInterval`. The 15s tick is therefore driven by a controlled
 * `window.setInterval` capture below: the mock records the armed cadence and
 * hands back a single `advance()` that fires the tick — which is the
 * "advance 15000ms" step expressed reliably in this realm.
 */

const MEMBER: SessionMember = { email: "maya@team.co", role: "MEMBER" };
const LEAD: SessionMember = { email: "lead@team.co", role: "LEAD" };

const now = Date.parse("2024-06-02T12:00:00.000Z");

/* ------------------------------------------------------------------ *
 * next/navigation — the App Router hooks, stood in for jsdom.
 * ------------------------------------------------------------------ */

const router = {
  push: jest.fn(),
  replace: jest.fn(),
  refresh: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  prefetch: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/**
 * Builds a kudos in the uniform ADR-7 shape.
 *
 * `index` 0 is the **newest** (`now`), each later index one minute older — so
 * `kudos(0..19)` is a newest-first page 1 and `kudos(20..39)` the page 2 that
 * follows it, with no createdAt tie except where a spec wants one.
 */
function kudos(index: number, overrides: Partial<Kudos> = {}): Kudos {
  return {
    id: `kudos-${String(index + 1).padStart(2, "0")}`,
    recipient: `recipient-${index + 1}@team.co`,
    message: `Kudos number ${index + 1} — thank you!`,
    author: { id: `author-${index}`, email: `author-${index}@team.co` },
    createdAt: new Date(now - index * 60_000).toISOString(),
    reactions:
      index % 3 === 0
        ? [
            { emoji: "🎉", count: 2, mine: false },
            { emoji: "❤️", count: 1, mine: false },
          ]
        : [],
    ...overrides,
  };
}

/** A whole page of kudos, newest first. */
function page(count = KUDOS_PAGE_SIZE): Kudos[] {
  return Array.from({ length: count }, (_, index) => kudos(index));
}

/** Minimum Response-shaped mock resolved from a JSON body. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** The board's list envelope, as `GET /api/v1/kudos` returns it. */
function envelope(rows: Kudos[], pageNumber = 1): KudosPage {
  return {
    data: rows,
    page: pageNumber,
    pageSize: KUDOS_PAGE_SIZE,
    total: rows.length,
  };
}

/** One captured request. */
interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/**
 * Installs a `global.fetch` mock plus a controlled 15s clock.
 *
 * `respond` maps a request to its response, so each spec owns its API.
 */
function installBoardFetch(
  respond: (request: CapturedRequest) => Response | Promise<Response>,
): {
  requests: CapturedRequest[];
  advance: (intervalMs?: number) => void;
  armedIntervalMs: () => number | null;
} {
  const requests: CapturedRequest[] = [];

  let intervalHandler: (() => void) | null = null;
  let armedMs: number | null = null;
  window.setInterval = ((handler: () => void, timeout?: number) => {
    intervalHandler = handler;
    armedMs = timeout ?? null;
    return 0;
  }) as unknown as typeof window.setInterval;

  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  fetchMock.mockImplementation(async (url, init) => {
    const request: CapturedRequest = { url: String(url), init };
    requests.push(request);
    return respond(request);
  });
  (globalThis as { fetch: unknown }).fetch = fetchMock;

  return {
    requests,
    armedIntervalMs: () => armedMs,
    advance: (intervalMs = 15_000) => {
      if (armedMs !== null && armedMs !== intervalMs) {
        throw new Error(`expected a ${intervalMs}ms interval, found ${armedMs}ms`);
      }
      const handler = intervalHandler;
      if (handler === null) {
        throw new Error("no board interval is armed");
      }
      act(() => {
        handler();
      });
    },
  };
}

/** Renders the board island the way the route does. */
function setup(
  initialKudos: Kudos[],
  member: SessionMember = MEMBER,
): ReturnType<typeof render> {
  return render(
    <>
      <BoardClient member={member} initialKudos={initialKudos} />
      <Toaster />
    </>,
  );
}

/** The kudos cards currently on the board, top to bottom. */
function boardCards(): HTMLElement[] {
  return screen.getAllByTestId("kudos-card");
}

/** A card's recipient heading text. */
function cardRecipient(card: HTMLElement): string {
  const heading = within(card).getAllByRole("heading")[0];
  if (heading === undefined) {
    throw new Error("card has no recipient heading");
  }
  return heading.textContent ?? "";
}

/** Types into a labelled composer field. */
function fillField(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  router.refresh.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */

it("[AC-7] submitting the composer with a recipient and a message makes the new kudos appear at the top of the board list showing recipient, message and author", async () => {
  const server = installBoardFetch((request) => {
    if (request.url.includes("/kudos?")) {
      return jsonResponse(envelope([kudos(0)]));
    }
    if (request.url.endsWith("/kudos")) {
      return jsonResponse(
        {
          id: "kudos-new",
          recipient: "priya@team.co",
          message: "Shipped the migration on a Friday. Legend.",
          author: { id: "member-1", email: "maya@team.co" },
          createdAt: new Date(now).toISOString(),
          reactions: [],
        },
        201,
      );
    }
    return jsonResponse({ message: "not found" }, 404);
  });

  setup([kudos(0)]);

  // The composer is on the board and starts disabled.
  expect(screen.getByRole("button", { name: "Send kudos" })).toBeDisabled();

  fillField("To", "priya@team.co");
  fillField("Your thanks", "Shipped the migration on a Friday. Legend.");
  expect(screen.getByRole("button", { name: "Send kudos" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "Send kudos" }));

  await waitFor(() => {
    expect(boardCards().length).toBe(2);
  });

  // The created kudos is at the top of the list…
  const top = boardCards()[0];
  expect(top).toHaveAttribute("data-kudos-id", "kudos-new");
  // …showing recipient, message and author.
  expect(cardRecipient(top)).toBe("priya@team.co");
  expect(within(top).getByTestId("kudos-card-message").textContent).toBe(
    "Shipped the migration on a Friday. Legend.",
  );
  expect(within(top).getByTestId("kudos-card-author").textContent).toBe(
    "maya@team.co",
  );

  // The POST really went to EP-4 with the drafted body.
  const post = server.requests.find((request) => request.url.endsWith("/kudos"));
  expect(post).toBeDefined();
  expect(post?.init?.method).toBe("POST");
  expect(JSON.parse(String(post?.init?.body))).toEqual({
    recipient: "priya@team.co",
    message: "Shipped the migration on a Friday. Legend.",
  });
});

/* -------------------------------------------------------------------------- */

it("[AC-12] the board renders the 20 newest kudos each showing recipient, message, author and reaction counts, and the pagination control loads the next 20 on page 2", async () => {
  const pageOne = page(20);
  const pageTwo = Array.from({ length: 20 }, (_, index) =>
    kudos(20 + index, { id: `kudos-${21 + index}` }),
  );

  const server = installBoardFetch((request) => {
    const requested = Number(
      new URL(request.url).searchParams.get("page") ?? "1",
      10,
    );
    if (requested === 2) {
      return jsonResponse(envelope(pageTwo, 2), 200);
    }
    return jsonResponse(envelope(pageOne, 1));
  });

  setup(pageOne);

  // Page 1 server-rendered: exactly 20 cards, newest first.
  const cards = boardCards();
  expect(cards).toHaveLength(KUDOS_PAGE_SIZE);
  expect(cards[0]).toHaveAttribute("data-kudos-id", "kudos-01");
  expect(cards[cards.length - 1]).toHaveAttribute("data-kudos-id", "kudos-20");

  // Each card shows recipient, message and author.
  for (const card of cards.slice(0, 3)) {
    expect(cardRecipient(card)).toMatch(/recipient-\d+@team\.co/);
    expect(within(card).getByTestId("kudos-card-message").textContent).toMatch(
      /Kudos number \d+/,
    );
    expect(within(card).getByTestId("kudos-card-author").textContent).toMatch(
      /author-\d+@team\.co/,
    );
  }

  // Card 1 (index 0) carries the reaction counts 🎉2 and ❤️1: the chip's
  // accessible name carries the count, the visible count is its own node.
  const reacted = within(cards[0]).getAllByRole("button", { name: /React/ });
  const labels = reacted.map((chip) => chip.getAttribute("aria-label") ?? "");
  expect(labels).toEqual(
    expect.arrayContaining([
      expect.stringContaining("React 🎉 — 2 so far"),
      expect.stringContaining("React ❤️ — 1 so far"),
    ]),
  );

  // Pagination is the explicit numbered control, page 2 loads the next 20.
  const nav = screen.getByRole("navigation", { name: "Board pages" });
  expect(within(nav).getByTestId("pagination-page-2")).toHaveAttribute(
    "aria-label",
    "Page 2",
  );

  fireEvent.click(within(nav).getByTestId("pagination-page-2"));

  await waitFor(() => {
    expect(boardCards()[0]).toHaveAttribute("data-kudos-id", "kudos-21");
  });
  expect(boardCards()).toHaveLength(20);

  const pageTwoRequest = server.requests.find(
    (request) => new URL(request.url).searchParams.get("page") === "2",
  );
  expect(pageTwoRequest).toBeDefined();

  // The current page is marked, and the URL carries it.
  expect(screen.getByTestId("board-pagination")).toHaveAttribute("data-page", "2");
  expect(window.location.search).toContain("page=2");
});

/* -------------------------------------------------------------------------- */

it("[AC-13] with fake timers, a kudos fetched by the 15s poll (posted from another session) appears on the open board without any manual page reload", async () => {
  const initial = page(3);
  const postedElsewhere = kudos(0, {
    id: "kudos-from-other-session",
    recipient: "sam.chen@team.co",
    message: "Covered the on-call rotation solo. Hero.",
    createdAt: new Date(now + 5_000).toISOString(),
    reactions: [],
  });

  const server = installBoardFetch(() =>
    jsonResponse(envelope([postedElsewhere, ...initial])),
  );

  setup(initial);

  // The board rendered its server page; the other session's kudos is not on it.
  expect(boardCards()).toHaveLength(3);
  expect(
    boardCards().some((card) =>
      card.getAttribute("data-kudos-id")?.includes("other-session"),
    ),
  ).toBe(false);

  // The poll is armed at exactly the 15s cadence (ADR-3).
  expect(server.armedIntervalMs()).toBe(15_000);

  // …15 seconds pass…
  await act(async () => {
    server.advance(15_000);
    await Promise.resolve();
  });

  // …and the other session's kudos is on the board, at the top, with no reload.
  await waitFor(() => {
    expect(boardCards()).toHaveLength(4);
  });
  expect(boardCards().map((card) => card.getAttribute("data-kudos-id"))).toEqual([
    "kudos-from-other-session",
    "kudos-01",
    "kudos-02",
    "kudos-03",
  ]);
  expect(boardCards()[0]).toHaveAttribute(
    "data-kudos-id",
    "kudos-from-other-session",
  );

  // The list region is the polite live region that announces the arrival.
  expect(screen.getByTestId("board-list")).toHaveAttribute(
    "aria-live",
    "polite",
  );
  expect(screen.getByTestId("board-announcements").textContent).toContain(
    "New kudos for sam.chen@team.co",
  );

  // And no navigation happened — the board updated in place.
  expect(router.push).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
});

/* -------------------------------------------------------------------------- */
/* Guard rails — no AC id in the title, so these claim no AC evidence.         */
/* -------------------------------------------------------------------------- */

describe("board client guard rails", () => {
  it("renders the board-empty state when page 1 has no kudos", () => {
    installBoardFetch(() => jsonResponse(envelope([])));
    setup([]);
    expect(
      screen.getByText("No kudos yet — be the first to say thanks."),
    ).toBeInTheDocument();
  });

  it("shows an inline error with Try again when a page fetch fails, and keeps serving kudos", async () => {
    let failNext = false;
    const server = installBoardFetch((request) => {
      const requested = Number(
        new URL(request.url).searchParams.get("page") ?? "1",
        10,
      );
      if (failNext && requested === 2) {
        return jsonResponse({ message: "boom" }, 500);
      }
      return jsonResponse(
        envelope(requested === 2 ? page(20).slice(10) : page(20), requested),
      );
    });

    setup(page(20));

    failNext = true;
    fireEvent.click(screen.getByTestId("pagination-page-2"));

    expect(await screen.findByTestId("board-error")).toBeInTheDocument();
    expect(screen.getByTestId("board-retry")).toBeInTheDocument();

    failNext = false;
    fireEvent.click(screen.getByTestId("board-retry"));
    await waitFor(() => {
      expect(screen.queryByTestId("board-error")).toBeNull();
    });
    expect(server.requests.length).toBeGreaterThan(1);
  });

  it("renders the lead-only Hidden only toggle and hide control for a LEAD session", () => {
    installBoardFetch(() => jsonResponse(envelope(page(1))));
    setup(page(1), LEAD);
    expect(screen.getByTestId("hidden-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("hide-control")).toBeInTheDocument();
  });

  it("renders neither the Hidden only toggle nor any hide control for a member", () => {
    installBoardFetch(() => jsonResponse(envelope(page(1))));
    setup(page(1), MEMBER);
    expect(screen.queryByTestId("hidden-toggle")).toBeNull();
    expect(screen.queryByTestId("hide-control")).toBeNull();
  });
});
