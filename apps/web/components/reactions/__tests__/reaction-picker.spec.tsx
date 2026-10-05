/**
 * @jest-environment ./components/signin/jest-jsdom-environment
 */

// Installs a jsdom window/document when Jest runs in the `node` test environment.
import "../../../test/setup-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Kudos, ReactionSummary } from "../../../lib/api/types";
import ReactionPicker from "../reaction-picker";
import * as reactionsModule from "../../../lib/api/reactions";

/**
 * ReactionPicker acceptance specs — exactly one `it()` per AC id owned by this
 * task, as the task specifies.
 *
 * - [AC-14] picking an emoji PUTs `/kudos/:id/reactions` and the chip row shows
 *   that reaction at count 1 with the mine pill.
 * - [AC-15] reacting again with a different emoji replaces the previous
 *   reaction — exactly one mine pill, never duplicated.
 *
 * `lib/api/reactions.ts` (the EP-5 client) is mocked at the module boundary, so
 * these are UI-behaviour specs: the picker's optimistic update, its replace
 * semantics and its reconciliation against the ADR-7 body are all driven through
 * the real component. The id/emoji contract of the PUT itself is asserted on the
 * mocked `setReaction`'s call args.
 *
 * The jsdom environment is pinned by the docblock above because
 * `jest-environment-jsdom` is not installed in this workspace (only `jsdom`
 * itself is); `test/setup-dom.ts` then makes the same spec run under the `node`
 * environment too. Interactions use `fireEvent` rather than
 * `@testing-library/user-event`, which is likewise not installed.
 */

/** The kudos being reacted to. */
const KUDOS_ID = "kudos-1";

/** The other members' row that is already on the card. */
const EXISTING_ROWS: readonly ReactionSummary[] = [
  { emoji: "❤️", count: 2, mine: false },
];

/** The updated kudos the API answers with, with per-call reactions swapped in. */
function kudosWith(reactions: readonly ReactionSummary[]): Kudos {
  return {
    id: KUDOS_ID,
    recipient: "Priya N.",
    message:
      "Shipped the migration on a Friday and nothing caught fire. Legend.",
    author: { id: "member-1", email: "maya@team.co" },
    createdAt: "2025-01-01T09:00:00.000Z",
    reactions,
  };
}

/**
 * The EP-5 client is mocked at the API boundary; the re-exports the picker
 * re-uses from it (`isReactionEmoji`, `REACTION_EMOJI_SET`) come along so the
 * component still sees the real curated set.
 */
jest.mock("../../../lib/api/reactions", () => ({
  __esModule: true,
  ...jest.requireActual("../../../lib/api/types"),
  setReaction: jest.fn(),
}));

/** The mocked EP-5 client, typed as the real module's `setReaction`. */
const setReactionMock = reactionsModule.setReaction as jest.MockedFunction<
  typeof reactionsModule.setReaction
>;

/** The chip button for one emoji. */
function chip(emoji: string): HTMLElement {
  return screen.getByTestId(`reaction-chip-${emoji}`);
}

/** The popover option button for one emoji. */
function option(emoji: string): HTMLElement {
  return screen.getByTestId(`reaction-option-${emoji}`);
}

/** Every chip button currently in the chip row. */
function allChips(): HTMLElement[] {
  // The row wrapper carries `data-testid="reaction-chip-row"`, which the prefix
  // pattern would otherwise match, so narrow to the buttons themselves.
  return screen
    .getAllByTestId(/reaction-chip-/)
    .filter((element) => element.tagName === "BUTTON");
}

/** The chips currently marked as the viewer's own. */
function mineChips(): HTMLElement[] {
  return allChips().filter(
    (element) => element.getAttribute("data-mine") === "true",
  );
}

/** Opens the popover and clicks one emoji, exactly as a member would. */
async function pickEmoji(emoji: string): Promise<void> {
  fireEvent.click(screen.getByTestId("reaction-picker-trigger"));
  // The popover renders in this commit; the option is then present.
  fireEvent.click(option(emoji));
  await waitFor(() => expect(setReactionMock).toHaveBeenCalled());
}

beforeEach(() => {
  setReactionMock.mockReset();
});

it("[AC-14] picking an emoji PUTs /kudos/:id/reactions and the chip row shows that reaction at count 1 with the mine pill", async () => {
  // EP-5 upserts the member's reaction onto an emoji nobody had chosen yet.
  setReactionMock.mockResolvedValue(
    kudosWith([...EXISTING_ROWS, { emoji: "🎉", count: 1, mine: true }]),
  );

  render(<ReactionPicker kudosId={KUDOS_ID} reactions={EXISTING_ROWS} />);

  // Before any pick: no 🎉 chip exists, and nothing is marked mine.
  expect(screen.queryByTestId("reaction-chip-🎉")).not.toBeInTheDocument();
  expect(chip("❤️")).toHaveAttribute("data-mine", "false");
  expect(chip("❤️").getAttribute("aria-label")).toBe(
    "React ❤️ — 2 so far — not yours yet",
  );
  expect(mineChips()).toHaveLength(0);

  await pickEmoji("🎉");

  // EP-5 was called exactly once for this kudos, with the picked emoji.
  await waitFor(() => expect(setReactionMock).toHaveBeenCalledTimes(1));
  expect(setReactionMock).toHaveBeenCalledWith(KUDOS_ID, "🎉");

  // The chip row shows that reaction at count 1, as the viewer's own pill.
  const mine = chip("🎉");
  expect(mine).toBeInTheDocument();
  expect(mine).toHaveTextContent("1");
  expect(mine).toHaveAttribute("data-mine", "true");
  expect(mine).toHaveAttribute("data-state", "mine");
  expect(mine).toHaveAttribute("aria-pressed", "true");
  expect(mine.getAttribute("aria-label")).toBe(
    "React 🎉 — 1 so far — your reaction",
  );

  // The other members' reaction is untouched and stays not-mine.
  expect(chip("❤️")).toHaveTextContent("2");
  expect(chip("❤️")).toHaveAttribute("data-mine", "false");

  // Exactly one pill is the viewer's.
  expect(mineChips()).toHaveLength(1);

  // The popover closed and the busy state cleared once the 2xx reconciled.
  await waitFor(() =>
    expect(
      screen.queryByTestId("reaction-picker-menu"),
    ).not.toBeInTheDocument(),
  );
  expect(chip("🎉")).toHaveAttribute("data-state", "mine");
});

it("[AC-15] reacting again with a different emoji replaces the previous reaction — exactly one mine pill, never duplicated", async () => {
  // The member has already reacted 🎉, then switches to 🙌.
  setReactionMock
    .mockResolvedValueOnce(
      kudosWith([...EXISTING_ROWS, { emoji: "🎉", count: 1, mine: true }]),
    )
    // The second PUT *replaces* the caller's single reaction: 🎉 back to zero
    // and gone from the row, 🙌 at count 1 and mine.
    .mockResolvedValueOnce(
      kudosWith([...EXISTING_ROWS, { emoji: "🙌", count: 1, mine: true }]),
    );

  render(<ReactionPicker kudosId={KUDOS_ID} reactions={EXISTING_ROWS} />);

  await pickEmoji("🎉");

  // The first reaction landed: one mine pill, on 🎉 at count 1.
  expect(chip("🎉")).toHaveAttribute("data-mine", "true");
  expect(chip("🎉")).toHaveTextContent("1");
  expect(mineChips()).toHaveLength(1);

  // React again with a *different* emoji.
  fireEvent.click(screen.getByTestId("reaction-picker-trigger"));
  fireEvent.click(option("🙌"));
  await waitFor(() => expect(setReactionMock).toHaveBeenCalledTimes(2));
  expect(setReactionMock).toHaveBeenLastCalledWith(KUDOS_ID, "🙌");

  // The counts reconciled: 🙌 is the viewer's only reaction, 🎉 is gone.
  await waitFor(() => {
    expect(screen.queryByTestId("reaction-chip-🎉")).not.toBeInTheDocument();
  });
  expect(chip("🙌")).toBeInTheDocument();
  expect(chip("🙌")).toHaveTextContent("1");
  expect(chip("🙌")).toHaveAttribute("data-mine", "true");
  expect(chip("🙌").getAttribute("aria-label")).toBe(
    "React 🙌 — 1 so far — your reaction",
  );

  // Exactly one mine pill survives the replacement — never two, never zero.
  expect(mineChips()).toHaveLength(1);

  // The whole row is consistent with the ADR-7 body the next poll would merge:
  // no leftover row still claims to be the viewer's old reaction.
  expect(
    allChips().map((element) => element.getAttribute("aria-label")),
  ).toEqual([
    "React ❤️ — 2 so far — not yours yet",
    "React 🙌 — 1 so far — your reaction",
  ]);
});
