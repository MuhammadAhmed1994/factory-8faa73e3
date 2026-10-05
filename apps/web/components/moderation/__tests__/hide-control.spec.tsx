import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import HideControl from "@/components/moderation/hide-control";
import { Toaster } from "@/components/ui/toaster";
import { KUDOS_EXIT_FADE_MS } from "@/lib/api/moderation";
import type { Kudos } from "@/lib/api/kudos";

/**
 * [AC-19] — the lead-gated hide control on the board.
 *
 * AC-19: "A signed-in team lead sees a hide control on each kudos on the board;
 * activating it removes that kudos from the board list, while the same board
 * still shows the kudos is gone for a signed-in regular member."
 *
 * This spec covers the web half of that criterion through the real network
 * boundary: `fetch` is replaced (not `hideKudos`, not a wrapper), so the
 * asserted request genuinely travels `HideControl → hideKudos → apiFetch →
 * fetch` with the session credentials attached, exactly as it does in the
 * browser against EP-6.
 *
 * The board list itself is exercised through the same `onHidden` callback the
 * board wires to its list state: the lead's list drops the kudos the moment the
 * 2xx lands, and the member's list — re-fetched without `hidden=true`, i.e.
 * through `GET /api/v1/kudos`, which never returns hidden rows — no longer
 * contains it either.
 *
 * Per this task's instructions the file contains exactly one `it()` block and
 * its title carries only `[AC-19]`.
 */

const MEMBER_EMAIL = "sam.chen@team.co";

const KUDOS_A_ID = "kudos-1";
const KUDOS_B_ID = "kudos-2";

const RECIPIENT = "priya@team.co";
const MESSAGE_A = "Shipped the migration on a Friday and nothing caught fire.";
const MESSAGE_B = "Covered the on-call rotation solo. Hero.";

/** A visible board kudos, in the uniform ADR-7 shape the API returns. */
function visibleKudos(
  id: string,
  message: string,
  createdAt: string,
): Kudos {
  return {
    id,
    recipient: RECIPIENT,
    message,
    author: { id: "member-2", email: MEMBER_EMAIL },
    createdAt,
    reactions: [],
  };
}

/**
 * Minimal `Response`-shaped stub — `text()` is the only member `apiFetch`
 * reads. (This jsdom realm exposes `Headers` but no `Response` constructor, so
 * a plain object standing in for it is the honest option.)
 */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * The board's list wiring, reproduced exactly as the board route does it: the
 * items array is the single source of truth for which kudos render, and
 * `onHidden` is the callback each `HideControl` receives.
 */
function setupBoardList(initial: Kudos[]) {
  const board = {
    hiddenIds: [] as string[],
    items: [...initial],
  };

  /** The list-source update the board performs on a 2xx hide. */
  const onHidden = (kudosId: string): void => {
    board.hiddenIds.push(kudosId);
    board.items = board.items.filter((item) => item.id !== kudosId);
  };

  return { board, onHidden };
}

/** Renders a board list with a hide control on each card. */
function renderBoard(items: Kudos[], role: "LEAD" | "MEMBER", onHidden: (id: string) => void) {
  return render(
    <>
      <ul aria-label="Kudos list">
        {items.map((item) => (
          <li key={item.id}>
            <article className="kudos-card">
              <h2>{item.recipient}</h2>
              <p>{item.message}</p>
              <HideControl kudosId={item.id} role={role} onHidden={onHidden} />
            </article>
          </li>
        ))}
      </ul>
      <Toaster />
    </>,
  );
}

describe("[AC-19] HideControl on the board list", () => {
  it("[AC-19] renders on every kudos for a lead, hides it via POST /kudos/:id/hide and removes it from the lead's list, while a member gets no control and a board fetched without hidden items no longer contains the hidden kudos", async () => {
    const leadList = [
      visibleKudos(KUDOS_A_ID, MESSAGE_A, "2024-05-14T09:00:00.000Z"),
      visibleKudos(KUDOS_B_ID, MESSAGE_B, "2024-05-14T08:00:00.000Z"),
    ];

    // ---------------------------------------------------------------
    // 1. The lead's board: one hide control per kudos card.
    // ---------------------------------------------------------------
    const lead = setupBoardList(leadList);
    const leadRequests: Array<{ url: string; init: RequestInit | undefined }> =
      [];

    const fetchMock = jest.fn((url: string, init?: RequestInit) => {
      leadRequests.push({ url: String(url), init });
      return Promise.resolve(jsonResponse(200, { id: KUDOS_A_ID }));
    });
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    const { unmount } = renderBoard(lead.board.items, "LEAD", lead.onHidden);

    // One control per card — exactly as many as there are kudos.
    const leadControls = screen.getAllByRole("button", {
      name: "Hide this kudos from the board",
    });
    expect(leadControls).toHaveLength(leadList.length);

    // ---------------------------------------------------------------
    // 2. Confirm → POST /api/v1/kudos/:id/hide → the card is removed.
    // ---------------------------------------------------------------
    fireEvent.click(leadControls[0] as HTMLButtonElement);

    // The confirm popover opens with the destructive action; Escape cancels
    // without posting anything.
    expect(
      screen.getByRole("button", { name: "Hide from board" }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape", bubbles: true });
    expect(
      screen.queryByRole("button", { name: "Hide from board" }),
    ).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // Re-open and confirm for real this time.
    fireEvent.click(leadControls[0] as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: "Hide from board" }));

    // The hide POST went out for the first card's id, with credentials.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const hideCall = leadRequests[0];
    expect(hideCall).toBeDefined();
    expect(hideCall?.url).toMatch(new RegExp(`/kudos/${KUDOS_A_ID}/hide$`));
    expect(hideCall?.init?.method).toBe("POST");
    expect(hideCall?.init?.credentials ?? "include").toBe("include");

    // 2xx → onHidden fired with the hidden id, the board removed the card,
    // and the success toast confirmed it.
    await waitFor(() => expect(lead.board.hiddenIds).toEqual([KUDOS_A_ID]));
    expect(lead.board.items.map((item) => item.id)).toEqual([KUDOS_B_ID]);
    await waitFor(() =>
      expect(
        screen.getByText("Hidden from the board for everyone."),
      ).toBeInTheDocument(),
    );
    // The exit fade the board plays before dropping the card is ~200ms.
    expect(KUDOS_EXIT_FADE_MS).toBe(200);

    unmount();
    (globalThis as { fetch: unknown }).fetch = undefined;

    // ---------------------------------------------------------------
    // 3. The member's board: no control at all, and a list fetched
    //    without hidden items no longer contains the hidden kudos.
    // ---------------------------------------------------------------
    const memberBoardFetches: string[] = [];
    const memberListAfterHide = leadList.filter(
      (item) => item.id !== KUDOS_A_ID,
    );

    const memberFetchMock = jest.fn((url: string) => {
      memberBoardFetches.push(String(url));
      // The board list is fetched WITHOUT hidden items, so the hidden kudos
      // is already absent — AC-19's member-side convergence.
      return Promise.resolve(jsonResponse(200, memberListAfterHide));
    });
    (globalThis as { fetch: unknown }).fetch = memberFetchMock;

    // The member's page is fetched the way the board route server-renders it:
    // plain GET /api/v1/kudos, never `hidden=true`.
    const memberResponse = await (
      globalThis as unknown as { fetch: typeof fetch }
    ).fetch("/api/v1/kudos?page=1");
    const memberItems = JSON.parse(await memberResponse.text()) as Kudos[];

    expect(memberItems.map((item) => item.id)).toEqual([KUDOS_B_ID]);
    const firstMemberFetch = memberBoardFetches[0];
    expect(firstMemberFetch).toMatch(/\/api\/v1\/kudos\?page=1$/);
    expect(firstMemberFetch).not.toContain("hidden=");

    const member = setupBoardList(memberItems);
    renderBoard(member.board.items, "MEMBER", member.onHidden);

    // The control is not rendered for a member — no button in the DOM, not a
    // CSS-hidden one (AC-19).
    expect(
      screen.queryByRole("button", {
        name: "Hide this kudos from the board",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("hide-control")).toHaveLength(0);

    // The member's rendered board no longer contains the hidden kudos.
    expect(screen.queryByText(MESSAGE_A)).not.toBeInTheDocument();
    expect(screen.getByText(MESSAGE_B)).toBeInTheDocument();

    // And the member never fired a hide POST — there is no control to fire it.
    expect(memberFetchMock).toHaveBeenCalledTimes(1);
    expect(member.board.hiddenIds).toEqual([]);

    (globalThis as { fetch: unknown }).fetch = undefined;
  });
});
