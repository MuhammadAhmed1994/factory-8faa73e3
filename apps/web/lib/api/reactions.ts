import {
  ApiError,
  UNAUTHORIZED_MESSAGE,
  VALIDATION_MESSAGE,
  apiPut,
  type ApiFetchOptions,
} from "../api-client";
import { isReactionEmoji, type Kudos } from "./types";

/**
 * Reactions API client (EP-5 → ADR-4 / ADR-7).
 *
 * A reaction is submitted as
 *
 * ```http
 * PUT /api/v1/kudos/:id/reactions
 * Content-Type: application/json
 *
 * { "emoji": "👍" }
 * ```
 *
 * The endpoint **upserts**: it creates or *replaces* the caller's single
 * reaction on that kudos — there is deliberately no toggle-to-remove, because
 * C-4 caps every member at exactly one reaction per kudos and ADR-4 makes the
 * replace semantics explicit (AC-15). On 2xx it answers with the updated kudos
 * in the uniform ADR-7 shape, which is everything the board needs to
 * re-render the chip row without a refetch.
 *
 * Everything goes through the shared {@link "../api-client".apiFetch} wrapper,
 * so base-URL resolution, the httpOnly session cookie (`credentials:
 * "include"`) and the `ApiError` mapping live in exactly one place.
 */

/** Re-exported so reaction UI has the contract one import away. */
export type { Kudos, ReactionSummary, ReactionEmoji } from "./types";
export { isReactionEmoji, REACTION_EMOJI_SET } from "./types";

/** Path of EP-5 with the kudos id substituted. */
function reactionsPath(kudosId: string): string {
  return `/kudos/${encodeURIComponent(kudosId)}/reactions`;
}

/** Body actually serialised onto the wire — exactly the one ADR-4 field. */
interface SetReactionRequestBody {
  readonly emoji: string;
}

/** Transport-level knobs `setReaction` still allows (cookie, signal, baseUrl…). */
export type SetReactionOptions = Omit<ApiFetchOptions, "method" | "body">;

/** Thrown when the caller asks for an emoji outside the curated set. */
export class InvalidReactionEmojiError extends Error {
  constructor() {
    super(VALIDATION_MESSAGE);
    this.name = "InvalidReactionEmojiError";
  }
}

/** Thrown when `kudosId` is blank, because the path would not be addressable. */
export class MissingKudosIdError extends Error {
  constructor() {
    super("A kudos id is required to react");
    this.name = "MissingKudosIdError";
  }
}

/**
 * Sets — creating or replacing — the signed-in member's single reaction on a
 * kudos (EP-5).
 *
 * Resolves with the updated kudos in the ADR-7 shape: `reactions` is already
 * grouped per emoji with `mine` on the caller's row, so the board can reconcile
 * its optimistic chip row against the server's truth.
 *
 * Rejects with a **typed** error in every failure mode, so callers branch on
 * the error rather than on response text:
 *
 * - {@link MissingKudosIdError}  no/blank `kudosId` was supplied.
 * - {@link InvalidReactionEmojiError}  the emoji is outside 👍 ❤️ 🎉 🙌; the API
 *   would answer `400` here, and pre-flight validation makes the picker's
 *   failure path testable without a server round-trip.
 * - `ApiError` `status === 400`  the API rejected the payload (ADR-4).
 * - `ApiError` `status === 401`  no valid session; the caller should route to
 *   `/signin` (AC-3). Rejected with {@link UNAUTHORIZED_MESSAGE} first in the
 *   message list, matching the copy the board renders.
 * - `ApiError` any other non-2xx, plus a plain `TypeError` when the API is
 *   unreachable.
 */
export async function setReaction(
  kudosId: string,
  emoji: string,
  options: SetReactionOptions = {},
): Promise<Kudos> {
  if (typeof kudosId !== "string" || kudosId.trim().length === 0) {
    throw new MissingKudosIdError();
  }

  if (!isReactionEmoji(emoji)) {
    throw new InvalidReactionEmojiError();
  }

  const body: SetReactionRequestBody = { emoji };

  try {
    return await apiPut<Kudos>(reactionsPath(kudosId), body, options);
  } catch (error: unknown) {
    if (error instanceof ApiError) {
      if (error.isUnauthorized) {
        // Keep the board's copy first without discarding the server's own line.
        throw new ApiError(
          error.status,
          [UNAUTHORIZED_MESSAGE, ...error.messages],
          error.body,
        );
      }
      if (error.isValidationFailure && error.messages.length === 0) {
        throw new ApiError(error.status, [VALIDATION_MESSAGE], error.body);
      }
    }
    throw error;
  }
}

export default setReaction;
