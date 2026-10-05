// Installs a jsdom window/document when Jest runs in the `node` test environment.
import "../../../test/setup-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import KudosComposer from "../kudos-composer";

/**
 * `[AC-7]` — after the member submits the kudos composer with a recipient and a
 * message, the created kudos is handed back to the board (which prepends it to
 * the top of the list) and the composer resets.
 *
 * Exactly one `it()` block, as this task specifies. The kudos API is mocked at
 * the network boundary, so the spec drives the real submit path —
 * `createKudos` → `POST /api/v1/kudos` — rather than stubbing the component's
 * own helpers.
 */

/** One recorded `fetch` call: `[input, init]`. */
type FetchCall = readonly [unknown, RequestInit | undefined];

/** The kudos the API returns on a `201` (ADR-7 shape). */
const CREATED_KUDOS = {
  id: "kudos-1",
  recipient: "Priya N.",
  message: "Shipped the migration on a Friday and nothing caught fire. Legend.",
  author: { id: "member-1", email: "maya@team.co" },
  createdAt: "2025-01-01T09:00:00.000Z",
  reactions: [{ emoji: "🎉", count: 0, mine: false }],
} as const;

/** Reads the JSON body a mocked `fetch` call received. */
function requestBodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
}

it("[AC-7] submitting the composer posts the kudos, hands it to onCreated and resets the form and 0/280 counter", async () => {
  const onCreated = jest.fn();
  const fetchMock = jest.fn().mockResolvedValue(
    new Response(JSON.stringify(CREATED_KUDOS), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  );
  jest.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

  render(<KudosComposer onCreated={onCreated} />);

  // The always-visible counter starts at 0/280.
  expect(screen.getByTestId("kudos-composer-counter")).toHaveTextContent(
    "0/280",
  );

  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: CREATED_KUDOS.recipient },
  });
  fireEvent.change(screen.getByLabelText("Your thanks"), {
    target: { value: CREATED_KUDOS.message },
  });
  expect(screen.getByTestId("kudos-composer-counter")).toHaveTextContent(
    `${CREATED_KUDOS.message.length}/280`,
  );

  fireEvent.click(screen.getByRole("button", { name: "Send kudos" }));

  // POST /api/v1/kudos was called once, with exactly the submitted body.
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:3000/api/v1/kudos");
  expect(requestBodyOf(fetchCall(fetchMock, 0))).toEqual({
    recipient: CREATED_KUDOS.recipient,
    message: CREATED_KUDOS.message,
  });

  // The board receives the created kudos to prepend to the top of the list.
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(onCreated).toHaveBeenCalledWith(CREATED_KUDOS);

  // Both fields reset and the counter returns to 0/280.
  await waitFor(() => {
    expect(screen.getByLabelText("To")).toHaveValue("");
    expect(screen.getByLabelText("Your thanks")).toHaveValue("");
  });
  expect(screen.getByTestId("kudos-composer-counter")).toHaveTextContent(
    "0/280",
  );
});

/** Narrows a recorded `fetch` call to {@link FetchCall} for the assertions above. */
function fetchCall(
  mock: { readonly mock: { readonly calls: readonly unknown[] } },
  index: number,
): FetchCall {
  return mock.mock.calls[index] as unknown as FetchCall;
}
