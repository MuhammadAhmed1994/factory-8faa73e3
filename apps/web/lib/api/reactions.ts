import { ApiError, type Kudos as ClientKudos } from "@/lib/api-client";
import {
  REACTION_EMOJIS,
  isCuratedReaction,
  normalizeReactions,
  type Kudos,
  type ReactionEmoji,
} from "@/lib/api/types";

/**
 * Reaction API surface (EP-5 — `PUT /api/v1/kudos/:id/reactions`, ADR-4).
 *
 * The endpoint is an **upsert-replace**: it creates *or replaces* the caller's
 * single reaction on that kudos and answers 2xx with the whole kudos in the
 * uniform ADR-7 shape, `reactions` recomputed at read time. That is what makes
 * the reaction UI's replace semantics (AC-15) a matter of forwarding the
 * response — the caller's previous emoji is overwritten server-side, never
 * added alongside, so exactly one summary is ever `mine`.
 *
 * Like `lib/api/auth.ts`, this call is **same-origin**: `next.config.ts`
 * rewrites `/api/v1/*` to the NestJS API, so the httpOnly session cookie
 * (ADR-1) stays first-party and rides along with
 * `credentials: "same-origin"`. A cross-origin base URL would put that cookie
 * into third-party-cookie territory and could silently drop the session.
 */

/** Same-origin reaction path prefix (proxied to the API by the rewrite). */
export const REACTIONS_ENDPOINT = "/api/v1/kudos";

/** Body of `PUT /api/v1/kudos/:id/reactions` — exactly one field (ADR-4). */
export interface SetReactionInput {
  emoji: ReactionEmoji;
}

/** Re-exported so callers have one import for the shared resource types. */
export type { Kudos, ReactionEmoji };

/** Anything a JSON error body may be. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Best-effort single human-readable message out of an API error body. */
function readErrorMessage(status: number, body: unknown): string {
  if (isRecord(body)) {
    const direct = body.message ?? body.error;
    if (typeof direct === "string" && direct.length > 0) {
      return direct;
    }
    if (Array.isArray(body.message)) {
      const parts = body.message.filter(
        (entry): entry is string => typeof entry === "string",
      );
      if (parts.length > 0) {
        return parts.join(", ");
      }
    }
  }
  if (typeof body === "string" && body.trim().length > 0) {
    return body.trim();
  }
  return `Request failed with status ${status}`;
}

/**
 * `PUT /api/v1/kudos/:id/reactions` (EP-5) — set or replace the signed-in
 * member's single reaction on a kudos.
 *
 * Rejects — before any network activity — when `emoji` is not one of the four
 * curated characters, so the picker can never ask for a reaction the API would
 * answer **400** for.
 *
 * Resolves with the updated kudos (ADR-7 shape, `reactions` normalised so the
 * chip row can render it directly) on any 2xx. Rejects with the shared typed
 * {@link ApiError} otherwise, so callers branch on the status rather than on
 * response text:
 *
 * - `status === 400` → an uncurated emoji / malformed body (`isValidation`).
 * - `status === 401` → the session is missing or invalid (`isUnauthenticated`).
 * - `status === 404` → the kudos id matches nothing.
 * - `status === 0`   → the API could not be reached at all.
 */
export async function setReaction(
  kudosId: string,
  emoji: ReactionEmoji,
): Promise<Kudos> {
  if (!isCuratedReaction(emoji)) {
    throw new ApiError(
      400,
      `emoji must be one of the curated reactions: ${REACTION_EMOJIS.join(" ")}`,
    );
  }

  const headers = new Headers({ "Content-Type": "application/json" });

  let response: Response;
  try {
    response = await fetch(
      `${REACTIONS_ENDPOINT}/${encodeURIComponent(kudosId)}/reactions`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ emoji } satisfies SetReactionInput),
        credentials: "same-origin",
        cache: "no-store",
      },
    );
  } catch (cause) {
    throw new ApiError(
      0,
      cause instanceof Error ? cause.message : "Network request failed",
    );
  }

  const raw = await response.text();
  let parsed: unknown = undefined;
  if (raw.trim().length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      readErrorMessage(response.status, parsed),
      parsed,
    );
  }

  // The API returns the whole kudos. `reactions` is normalised defensively (a
  // missing array, a zero count, a malformed second `mine`) so the chip row
  // never has to guard against a payload shape itself; `preferredEmoji` keeps
  // the emoji just submitted as the mine pill should a payload ever claim two.
  const kudos = (parsed ?? {}) as ClientKudos;
  const reactions = normalizeReactions(kudos.reactions, emoji);

  return { ...kudos, reactions };
}

export default setReaction;
