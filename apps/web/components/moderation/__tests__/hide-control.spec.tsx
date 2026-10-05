// Installs a jsdom window/document when Jest runs in the `node` test environment.
import "../../../test/setup-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import HideControl, { HIDE_CONTROL_LABEL } from "../hide-control";
import { apiGet, type Kudos, type KudosPage, type MemberRole } from "@/lib/api-client";

/**
 * `[AC-19]` — a signed-in team lead sees a hide control on each kudos on the
 * board; activating it removes that kudos from the board list, while the same
 * board still shows the kudos is gone for a signed-in regular member.
 *
 * Exactly one `it()` block, as this task specifies, covering the three
 * behaviours the task names: the control renders per card for a lead,
 * confirming it POSTs `/kudos/:id/hide` and removes the kudos via `onHidden`,
 * and a regular member gets no control while their list — fetched *without* the
 * hidden variant — no longer contains the hidden kudos.
 *
 * The network is mocked at `global.fetch`, the boundary the shared api client
 * calls, so the spec drives the real component → `hideKudos` → POST path rather
 * than stubbing the component's own helpers.
 */

/** The kudos the lead hides. */
const HIDDEN_TARGET: Kudos = {
  id: "k-1",
  recipient: "Priya N.",
  message: "Covered my on-call shift without being asked.",
  author: { id: "member-2", email: "sam@team.co" },
  createdAt: "2024-05-14T09:00:00.000Z",
  reactions: [{ emoji: "🎉", count: 1, mine: false }],
};

/** A second, untouched kudos — proves the removal is surgical. */
const SURVIVOR: Kudos = {
  id: "k-2",
  recipient: "Ari K.",
  message: "Rewrote the flaky test suite in a weekend.",
  author: { id: "member-3", email: "jo@team.co" },
  createdAt: "2024-05-13T09:00:00.000Z",
  reactions: [],
};

/** The lead's board before moderating. */
const LEAD_BOARD: readonly Kudos[] = [HIDDEN_TARGET, SURVIVOR];

/** The member's board after the hide: the target is absent for everyone. */
const MEMBER_BOARD: readonly Kudos[] = [SURVIVOR];

/** A JSON `Response` for the mocked `fetch`. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The board list the way the board page renders it: one card per kudos, each
 * carrying the lead-gated control. `onHidden` drops the card from the list —
 * the same callback the real board wires to its state.
 */
function BoardList({
  role,
  initial,
}: {
  readonly role: MemberRole;
  readonly initial: readonly Kudos[];
}) {
  const [items, setItems] = useState<readonly Kudos[]>(initial);

  return (
    <ul aria-label="Kudos list">
      {items.map((kudos) => (
        <li key={kudos.id}>
          <article className="kudos-card" data-kudos-id={kudos.id}>
            <h2>{kudos.recipient}</h2>
            <p>{kudos.message}</p>
            <HideControl
              kudosId={kudos.id}
              role={role}
              onHidden={(kudosId) =>
                setItems((previous) =>
                  previous.filter((kudos) => kudos.id !== kudosId),
                )
              }
            />
          </article>
        </li>
      ))}
    </ul>
  );
}

it("[AC-19] lead sees a hide control on every kudos, confirming posts /kudos/:id/hide and removes it, while the member board no longer lists it", async () => {
  const fetchMock = jest.fn<(input: unknown, init?: RequestInit) => Promise<Response>>();
  jest.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

  // ── Lead: the control renders on each kudos card ─────────────────────────
  const { unmount } = render(<BoardList role="LEAD" initial={LEAD_BOARD} />);

  const leadControls = screen.getAllByRole("button", {
    name: HIDE_CONTROL_LABEL,
  });
  expect(leadControls).toHaveLength(LEAD_BOARD.length);

  // ── Confirming invokes POST /kudos/:id/hide and removes the card ─────────
  fetchMock.mockResolvedValueOnce(jsonResponse({ id: HIDDEN_TARGET.id }, 200));

  fireEvent.click(leadControls[0]);

  // The confirm popover is the safety: no undo exists, so the destructive
  // action is a second, deliberate step.
  fireEvent.click(screen.getByRole("button", { name: "Hide from board" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock.mock.calls[0][0]).toBe(
    "http://localhost:3000/api/v1/kudos/k-1/hide",
  );
  expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
  // The httpOnly session cookie rides along (ADR-1) — never a token in JS.
  expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe(
    "include",
  );

  // The 200 resolves, the card fades, and onHidden drops it from the list.
  await waitFor(
    () => {
      expect(screen.queryByText(HIDDEN_TARGET.message)).not.toBeInTheDocument();
    },
    { timeout: 1500 },
  );
  // Only the target went; the survivor is untouched.
  expect(screen.getByText(SURVIVOR.message)).toBeInTheDocument();

  unmount();

  // ── Member: no control at all, and the hidden kudos is gone from the list ─
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      items: MEMBER_BOARD,
      page: 1,
      pageSize: 20,
      total: MEMBER_BOARD.length,
    } satisfies KudosPage),
  );

  const memberList = await apiGet<KudosPage>("/kudos?page=1");

  // The member's board is fetched without the hidden variant: no `hidden`
  // query param is ever sent, so the soft-hidden kudos cannot leak back in.
  const memberUrl = String(fetchMock.mock.calls[1][0]);
  expect(memberUrl).toBe("http://localhost:3000/api/v1/kudos?page=1");
  expect(memberUrl).not.toContain("hidden=");

  render(<BoardList role="MEMBER" initial={memberList.items} />);

  // Never CSS-hidden: the member's DOM carries no moderation affordance.
  expect(
    screen.queryByRole("button", { name: HIDE_CONTROL_LABEL }),
  ).not.toBeInTheDocument();

  // The same board shows the kudos is gone for the member too.
  expect(
    screen.queryByText(HIDDEN_TARGET.message),
  ).not.toBeInTheDocument();
  expect(screen.getByText(SURVIVOR.message)).toBeInTheDocument();
});
