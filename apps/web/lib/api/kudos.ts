import {
  apiPost,
  type ApiFetchOptions,
  type Kudos,
} from "../api-client";

/**
 * Kudos API client (EP-3 / EP-4 → ADR-7).
 *
 * Every call goes through the shared {@link "../api-client".apiFetch} wrapper so
 * base-URL resolution, the httpOnly session cookie (`credentials: "include"`)
 * and the uniform `ApiError` mapping live in exactly one place. Components never
 * `fetch` directly and never branch on response text — they branch on
 * `ApiError.status`.
 */

/** Hard cap on a kudos message (C-2 / AC-8). Mirrors the API's `CreateKudosDto`. */
export const KUDOS_MESSAGE_LIMIT = 280;

/** Body of `POST /api/v1/kudos`: who is thanked, and the thank-you note. */
export interface CreateKudosInput {
  /** The thanked colleague — her/his email or member id. */
  readonly recipient: string;
  /** The public note: 1–280 characters (AC-8 / AC-9). */
  readonly message: string;
}

/** Transport-level knobs `createKudos` still allows (cookie, signal, baseUrl…). */
export type CreateKudosOptions = Omit<ApiFetchOptions, "method" | "body">;

/** Body actually serialised onto the wire — exactly the two DTO fields. */
interface CreateKudosRequestBody {
  readonly recipient: string;
  readonly message: string;
}

/**
 * Posts one kudos (EP-4).
 *
 * Resolves with the created kudos in the uniform ADR-7 shape —
 * `{ id, recipient, message, author { id, email }, createdAt, reactions }` —
 * which is everything the board needs to prepend a card without a refetch
 * (AC-6 / AC-7).
 *
 * Rejects with an `ApiError` on any non-2xx: `400` carries the validation
 * messages the composer maps onto inline field errors (AC-8 / AC-9), `401`
 * means the session is gone and the caller should route to `/signin` (AC-3).
 */
export async function createKudos(
  input: CreateKudosInput,
  options: CreateKudosOptions = {},
): Promise<Kudos> {
  const body: CreateKudosRequestBody = {
    recipient: input.recipient,
    message: input.message,
  };
  return apiPost<Kudos>("/kudos", body, options);
}

export type {
  Kudos,
  KudosAuthor,
  ReactionSummary,
} from "../api-client";
