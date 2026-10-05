import {
  postKudos,
  type Kudos,
  type KudosAuthor,
  type KudosReaction,
} from "@/lib/api-client";

/**
 * Kudos API surface for the web app (EP-3 / EP-4).
 *
 * Every call goes through the shared client (`lib/api-client.ts`), which owns
 * the base-URL resolution, the httpOnly session cookie forwarding and the
 * `ApiError` mapping (401 / 403 / 400) — so the composer never talks to
 * `fetch` directly.
 *
 * The response type is the **uniform kudos resource of ADR-7**, returned
 * verbatim by list, create and react:
 *
 * ```json
 * {
 *   "id": "…",
 *   "recipient": "priya@team.co",
 *   "message": "…",
 *   "author": { "id": "…", "email": "maya@team.co" },
 *   "createdAt": "2024-05-01T10:00:00.000Z",
 *   "reactions": [{ "emoji": "🎉", "count": 3, "mine": false }]
 * }
 * ```
 */

/** Message cap shared by the client validation and the API (constraint C-2). */
export const KUDOS_MESSAGE_MAX_LENGTH = 280;

export type { Kudos, KudosAuthor, KudosReaction };

/** Body of `POST /api/v1/kudos` — exactly the two fields the composer holds. */
export interface CreateKudosInput {
  /** The colleague being thanked (member id or email). */
  recipient: string;
  /** The thank-you note, 1–280 characters. */
  message: string;
}

/**
 * Normalises a created kudos so a defensive caller never trips over a payload
 * that omits `reactions` (a freshly created kudos legitimately has none).
 *
 * Nothing is rewritten or dropped — only a missing `reactions` array becomes
 * `[]`, which is what ADR-7 specifies for a kudos with no reactions.
 */
function withDefaultReactions(created: Kudos): Kudos {
  return {
    ...created,
    reactions: Array.isArray(created.reactions) ? created.reactions : [],
  };
}

/**
 * `POST /api/v1/kudos` (EP-4) → the created kudos (AC-6 / AC-7).
 *
 * Resolves with the ADR-7 kudos shape on **201**. Rejects with `ApiError` for
 * every non-2xx response, so the composer can branch:
 *
 * - `status === 400` → the payload's field messages map onto inline errors
 *   (AC-8 over-limit, AC-9 missing recipient / empty message).
 * - `status === 401` → the session is gone; the caller routes to `/signin`.
 */
export async function createKudos(input: CreateKudosInput): Promise<Kudos> {
  const created = await postKudos({
    recipient: input.recipient,
    message: input.message,
  });

  return withDefaultReactions(created);
}

export default createKudos;
