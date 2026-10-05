/**
 * @jest-environment ./components/signin/jest-jsdom-environment
 */

// Installs a jsdom window/document when Jest runs in the `node` test environment.
import "../../../test/setup-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Kudos, KudosPage } from "../../../lib/api-client";
import BoardClient, { ARRIVAL_HIGHLIGHT_MS } from "../board-client";

/**
 * Board acceptance specs — exactly one `it()` per AC id this task owns, with
 * only that id in the title:
 *
 * - [AC-7]  submitting the composer with a recipient and a message makes the
 *           new kudos appear at the top of the board list showing recipient,
 *           message and author.
 * - [AC-12] the board renders the 20 newest kudos each showing recipient,
 *           message, author and reaction counts, and the pagination control
 *           loads the next 20 on page 2.
 * - [AC-13] with fake timers, a kudos fetched by the 15s poll (posted from
 *           another session) appears on the open board without any manual page
 *           reload.
 *
 * The network is mocked at `global.fetch` — the boundary the shared api client
 * calls — so each spec drives the real component → `lib/api` → `fetch` path,
 * including the composer's `POST /kudos`, the page-2 `GET /kudos?page=2` and
 * the poll's `GET /kudos?page=1`.
 *
 * `next/navigation`'s router is stubbed with spies because it is not wired up
 * under jsdom; the board uses it only to redirect on a 401, which none of these
 * three flows trigger.
 */

/** The signed-in member viewing the board. */
const VIEWER_EMAIL = "maya@team.co";
const VIEWER_ROLE = "MEMBER" as const;

/** Base URL every request goes through, for readable call assertions. */
const API_BASE = "http://localhost:3000/api/v1";

/** Author email of every seeded kudos. */
const AUTHOR_EMAIL = "sam@team.co";

/** The board's fixed page size (ADR-6). */
const PAGE_SIZE = 20;

/** How many kudos exist across the two pages, so page 2 is addressable. */
const TOTAL_KUDOS = 40;

/**
 * The wall-clock instant of the newest seeded kudos.
 *
 * Every later index is one second older, so index order *is* ADR-6 order:
 * newest first. Page 1 holds indices 0–19 (the newest 20) and page 2 holds
 * 20–39 (the older 20), with no kudos shared between them.
 */
const NEWEST_AT = Date.UTC(2025, 0, 2, 12, 0, 0);

/** Builds one kudos row; `index` 0 is the newest on the board. */
function makeKudos(index: number, overrides: Partial<Kudos> = {}): Kudos {
  const sequence = index + 1;
  return {
    id: `kudos-${String(sequence).padStart(2, "0")}`,
    recipient: `Recipient ${sequence}`,
    message: `Thank you for thing ${sequence}.`,
    author: { id: `author-${sequence}`, email: AUTHOR_EMAIL },
    createdAt: new Date(NEWEST_AT - index * 1000).toISOString(),
    reactions:
      sequence % 2 === 0
        ? [
            { emoji: "🎉", count: 2, mine: false },
            { emoji: "❤️", count: 1, mine: false },
          ]
        : [{ emoji: "👍", count: 1, mine: true }],
    ...overrides,
  };
}

/** Page 1 of the seeded board: the newest 20 of 40. */
const PAGE_ONE: readonly Kudos[] = Array.from({ length: PAGE_SIZE }, (_, i) =>
  makeKudos(i),
);

/** Page 2: the older 20. */
const PAGE_TWO: readonly Kudos[] = Array.from(
  { length: PAGE_SIZE },
  (_, i) => makeKudos(i + PAGE_SIZE),
);

/** `GET /api/v1/kudos?page=N` response body (ADR-6 shape). */
function makePage(items: readonly Kudos[], page: number): KudosPage {
  return { items, page, pageSize: PAGE_SIZE, total: TOTAL_KUDOS };
}

/** The kudos the member posts from the composer (AC-7). */
const POSTED_KUDOS: Kudos = {
  id: "kudos-posted",
  recipient: "Priya N.",
  message: "Shipped the migration on a Friday and nothing caught fire.",
  author: { id: "author-viewer", email: VIEWER_EMAIL },
  createdAt: new Date(NEWEST_AT + 60_000).toISOString(),
  reactions: [],
};

/** The kudos another session posts, delivered by a poll (AC-13). */
const POLLED_KUDOS: Kudos = {
  id: "kudos-polled",
  recipient: "Ari K.",
  message: "Covered my on-call shift without being asked.",
  author: { id: "author-other", email: "jo@team.co" },
  createdAt: new Date(NEWEST_AT + 120_000).toISOString(),
  reactions: [],
};

/** A `Response` for the mocked `fetch`. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Router spies — a client-side navigation is observable as a call. */
const replaceMock = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

/** Renders the board island exactly as `/` renders it: page 1, SSR-provided. */
function renderBoard() {
  return render(
    <BoardClient
      initialKudos={PAGE_ONE}
      initialPage={1}
      initialTotal={TOTAL_KUDOS}
      email={VIEWER_EMAIL}
      role={VIEWER_ROLE}
    />,
  );
}

/** The board list element, once it has rendered. */
async function boardList(): Promise<HTMLElement> {
  return screen.findByTestId("board-list");
}

/** The kudos cards in document order — newest first. */
async function boardCards(): Promise<readonly HTMLElement[]> {
  const list = await boardList();
  return within(list).getAllByTestId(/^kudos-card-/);
}

beforeEach(() => {
  replaceMock.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-7 — the composer's 201 prepends the created card at slot 1
// ─────────────────────────────────────────────────────────────────────────────

it("[AC-7] submitting the composer with a recipient and a message makes the new kudos appear at the top of the board list", async () => {
  const fetchMock = jest.fn().mockResolvedValue(jsonResponse(POSTED_KUDOS, 201));
  jest.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

  renderBoard();

  // The composer's labelled fields: `To` (recipient) and `Your thanks` (message).
  const recipientField = screen.getByLabelText("To");
  const messageField = screen.getByLabelText("Your thanks");

  await act(async () => {
    fireEvent.change(recipientField, {
      target: { value: POSTED_KUDOS.recipient },
    });
    fireEvent.change(messageField, {
      target: { value: POSTED_KUDOS.message },
    });
  });

  const submit = screen.getByRole("button", { name: /send kudos/i });
  expect(submit).not.toBeDisabled();

  await act(async () => {
    fireEvent.click(submit);
  });

  // POST /api/v1/kudos with exactly the two DTO fields (EP-4).
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/kudos`,
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          recipient: POSTED_KUDOS.recipient,
          message: POSTED_KUDOS.message,
        }),
      }),
    );
  });

  // The created card lands at slot 1, showing recipient, message and author.
  const cards = await boardCards();
  expect(cards).toHaveLength(PAGE_ONE.length + 1);

  const first = within(cards[0]);
  expect(first.getByTestId("kudos-recipient")).toHaveTextContent(
    POSTED_KUDOS.recipient,
  );
  expect(first.getByTestId("kudos-message")).toHaveTextContent(
    POSTED_KUDOS.message,
  );
  expect(first.getByTestId("kudos-author")).toHaveTextContent(VIEWER_EMAIL);

  // …and the board's own newest card is now second, still present.
  expect(within(cards[1]).getByTestId("kudos-recipient")).toHaveTextContent(
    PAGE_ONE[0].recipient,
  );

  // The composer reset: counter back to 0/280 (scr-board · success state).
  expect(await screen.findByText("0/280")).toBeInTheDocument();
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-12 — 20 newest rendered, and pagination loads the next 20
// ─────────────────────────────────────────────────────────────────────────────

it("[AC-12] the board renders the 20 newest kudos each showing recipient, message, author and reaction counts, and the pagination control loads the next 20 on page 2", async () => {
  const fetchMock = jest.fn().mockImplementation(async (input) => {
    const url = String(input);
    const isPageTwo = url.includes("page=2");
    return jsonResponse(
      makePage(isPageTwo ? PAGE_TWO : PAGE_ONE, isPageTwo ? 2 : 1),
    );
  });
  jest.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

  renderBoard();

  // Page 1 arrived server-side: 20 real cards, no skeleton flash.
  const pageOneCards = await boardCards();
  expect(pageOneCards).toHaveLength(PAGE_SIZE);
  expect(screen.queryByTestId("board-skeletons")).not.toBeInTheDocument();

  // Every card shows the recipient, message, author and its reaction counts.
  for (const card of pageOneCards) {
    const withinCard = within(card);
    expect(withinCard.getByTestId("kudos-recipient")).toBeInTheDocument();
    expect(withinCard.getByTestId("kudos-message")).toBeInTheDocument();
    expect(withinCard.getByTestId("kudos-author")).toBeInTheDocument();
    expect(
      withinCard.getAllByTestId(/^reaction-chip-/).length,
    ).toBeGreaterThan(0);
  }

  // Newest first: slot 1 is the newest kudos, slot 20 the oldest of the page.
  expect(
    within(pageOneCards[0]).getByTestId("kudos-recipient"),
  ).toHaveTextContent(PAGE_ONE[0].recipient);
  expect(
    within(pageOneCards[PAGE_SIZE - 1]).getByTestId("kudos-recipient"),
  ).toHaveTextContent(PAGE_ONE[PAGE_SIZE - 1].recipient);

  // Reaction counts come from `reactions [{emoji, count, mine}]` (ADR-7).
  const newest = within(pageOneCards[0]);
  expect(newest.getByText("1")).toBeInTheDocument();

  // The control is a navigation landmark, with page 1 marked current.
  const nav = screen.getByRole("navigation", { name: "Board pages" });
  const pageOneButton = within(nav).getByRole("button", {
    name: "Page 1, current page",
  });
  expect(pageOneButton).toHaveAttribute("aria-current", "page");

  // Page 2: the next 20, fetched client-side, none repeated from page 1.
  await act(async () => {
    fireEvent.click(within(nav).getByRole("button", { name: "Next page" }));
  });

  const pageTwoCards = await waitFor(async () => {
    const cards = await boardCards();
    expect(cards).toHaveLength(PAGE_SIZE);
    return cards;
  });

  expect(
    within(pageTwoCards[0]).getByTestId("kudos-recipient"),
  ).toHaveTextContent(PAGE_TWO[0].recipient);
  expect(
    within(pageTwoCards[PAGE_SIZE - 1]).getByTestId("kudos-recipient"),
  ).toHaveTextContent(PAGE_TWO[PAGE_SIZE - 1].recipient);

  // The page-2 request was made…
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/kudos?page=2`,
      expect.anything(),
    );
  });

  // …and no page-1 row leaked onto page 2 — no duplicates, no omissions.
  const pageOneIds = pageOneCards.map((card) => card.dataset.kudosId);
  const pageTwoIds = pageTwoCards.map((card) => card.dataset.kudosId);
  expect(pageTwoIds.filter((id) => pageOneIds.includes(id))).toEqual([]);
  expect(new Set([...pageOneIds, ...pageTwoIds]).size).toBe(TOTAL_KUDOS);

  // The URL carries the page, and the control marks page 2 current.
  expect(window.location.search).toContain("page=2");
  const navAfter = screen.getByRole("navigation", { name: "Board pages" });
  expect(
    within(navAfter).getByRole("button", { name: "Page 2, current page" }),
  ).toHaveAttribute("aria-current", "page");
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-13 — the 15s poll merges another session's kudos without a reload
// ─────────────────────────────────────────────────────────────────────────────

it("[AC-13] a kudos fetched by the 15s poll appears on the open board without any manual page reload", async () => {
  jest.useFakeTimers();

  try {
    /** How many polls have answered so far. */
    let polls = 0;

    const fetchMock = jest.fn().mockImplementation(async () => {
      // The first poll delivers the other session's kudos at the top of page 1.
      const items = polls === 0 ? [POLLED_KUDOS, ...PAGE_ONE] : PAGE_ONE;
      polls += 1;
      return jsonResponse(makePage(items, 1));
    });
    jest.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

    const { unmount } = renderBoard();

    // The board is open with its 20 server-rendered cards; no poll has run yet.
    await act(async () => {
      await Promise.resolve();
    });
    let cards = await boardCards();
    expect(cards).toHaveLength(PAGE_SIZE);
    expect(screen.queryByText(POLLED_KUDOS.message)).not.toBeInTheDocument();

    // Exactly 15 seconds pass with the tab open — one poll fires.
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });

    cards = await boardCards();
    expect(cards).toHaveLength(PAGE_SIZE + 1);

    // The polled kudos sits at the top, showing its own author.
    const first = within(cards[0]);
    expect(first.getByTestId("kudos-recipient")).toHaveTextContent(
      POLLED_KUDOS.recipient,
    );
    expect(first.getByTestId("kudos-message")).toHaveTextContent(
      POLLED_KUDOS.message,
    );
    expect(first.getByTestId("kudos-author")).toHaveTextContent(
      POLLED_KUDOS.author.email,
    );

    // The board's own newest card is still there, now second.
    expect(within(cards[1]).getByTestId("kudos-recipient")).toHaveTextContent(
      PAGE_ONE[0].recipient,
    );

    // The list never dropped into a loading state to get there.
    expect(screen.queryByTestId("board-skeletons")).not.toBeInTheDocument();

    // The arrival is announced politely as "New kudos for {recipient}".
    expect(
      screen.getByText(`New kudos for ${POLLED_KUDOS.recipient}`),
    ).toBeInTheDocument();

    // No navigation happened: this is a poll merge, not a reload.
    expect(replaceMock).not.toHaveBeenCalled();

    // The amber arrival wash clears itself once the ~1.2s highlight is over.
    await act(async () => {
      jest.advanceTimersByTime(ARRIVAL_HIGHLIGHT_MS + 50);
    });
    cards = await boardCards();
    expect(cards[0]).not.toHaveAttribute("data-arriving", "true");

    unmount();
  } finally {
    jest.useRealTimers();
  }
});
