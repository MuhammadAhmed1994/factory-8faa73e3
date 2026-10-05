import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import KudosComposer from "@/components/composer/kudos-composer";
import { Toaster } from "@/components/ui/toaster";
import type { Kudos } from "@/lib/api/kudos";

/**
 * [AC-7] — the kudos composer's submit path.
 *
 * AC-7: "After the member submits the kudos composer with a recipient and a
 * message, the new kudos appears at the top of the board list showing
 * recipient, message and author."
 *
 * This spec covers the composer's half of that criterion — the submit path the
 * board's `onCreated` handler depends on. `fetch` is replaced at the network
 * boundary (not `createKudos`), so the assertion that "POST was called with the
 * correct body" is real evidence about EP-4: the call travels through
 * `createKudos` → `postKudos` → `apiFetch` before it reaches `fetch`, exactly
 * as it does in the browser.
 *
 * Per this task's instructions, the file contains exactly one `it()` block and
 * its title carries only `[AC-7]`.
 */

const RECIPIENT = "priya@team.co";
const MESSAGE = "Shipped the migration on a Friday and nothing caught fire.";

/** Mounts the composer the way the board does, with the toast surface present. */
function setup(onCreated: (kudos: Kudos) => void) {
  render(
    <>
      <KudosComposer onCreated={onCreated} />
      <Toaster />
    </>,
  );
}

/** The ADR-7 kudos payload `KudosService.create` serialises for a 201. */
function createdKudos(): Kudos {
  return {
    id: "kudos-1",
    recipient: RECIPIENT,
    message: MESSAGE,
    author: { id: "member-1", email: "maya@team.co" },
    createdAt: "2024-05-01T10:00:00.000Z",
    reactions: [],
  };
}

/**
 * Minimal `Response`-shaped stub — `text()` is the only member `apiFetch` reads.
 * (The jsdom realm here exposes `Headers` but no `Response` constructor, so a
 * plain object standing in for it is the honest option.)
 */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe("[AC-7] KudosComposer submit path", () => {
  it("[AC-7] submits the composer's recipient and message to POST /api/v1/kudos and hands the created kudos to the board", async () => {
    const fetchMock = jest.fn(() => Promise.resolve(jsonResponse(201, createdKudos())));
    // jsdom ships no `fetch`; stand one in for the duration of the test.
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    const onCreated = jest.fn<void, [Kudos]>();
    setup(onCreated);

    const recipient = screen.getByLabelText("To");
    const message = screen.getByLabelText("Your thanks");

    // Pristine card: the counter is always visible and starts at 0/280.
    expect(screen.getByText("0/280")).toBeInTheDocument();
    expect(recipient).toHaveValue("");
    expect(message).toHaveValue("");
    // No maxlength: the 281+ state must stay typeable (AC-8 parity).
    expect(message).not.toHaveAttribute("maxlength");
    expect(message).not.toHaveAttribute("maxLength");

    fireEvent.change(recipient, { target: { value: RECIPIENT } });
    fireEvent.change(message, { target: { value: MESSAGE } });
    expect(screen.getByText(`${MESSAGE.length}/280`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send kudos" }));

    // The POST went out with exactly the composer's two fields.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toMatch(/\/api\/v1\/kudos$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: RECIPIENT,
      message: MESSAGE,
    });
    expect(new Headers(init.headers).get("Content-Type")).toBe(
      "application/json",
    );

    // The board received the created kudos, with the author the API attached.
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated).toHaveBeenCalledWith(createdKudos());

    // 201 — the form and the counter reset.
    await waitFor(() => {
      expect(screen.getByText("0/280")).toBeInTheDocument();
    });
    expect(recipient).toHaveValue("");
    expect(message).toHaveValue("");

    // "Kudos sent 🎉" fired as action feedback.
    await waitFor(() =>
      expect(screen.getByText("Kudos sent 🎉")).toBeInTheDocument(),
    );

    (globalThis as { fetch: unknown }).fetch = undefined;
  });
});
