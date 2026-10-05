/**
 * Moderation API client (EP-6 + the lead-only hidden review variant of EP-3, ADR-5).
 *
 * Two calls live here and nowhere else:
 *
 * - `hideKudos(id)` → `POST /api/v1/kudos/:id/hide` — the soft-hide a team lead
 *   performs so the kudos disappears from the board for everyone (AC-17/AC-19).
 * - `listHiddenKudos(page)` → `GET /api/v1/kudos?hidden=true&page=N` — the
 *   lead-only review list, in the standard ADR-7 kudos shape plus
 *   `hiddenAt`/`hiddenBy`.
 *
 * Both ride the shared {@link "../api-client".apiFetch} wrapper, which resolves
 * the base URL and always sends `credentials: "include"` so the httpOnly
 * session cookie (ADR-1) travels with the request — the browser never sees the
 * token itself.
 *
 * Neither function *throws* for an ordinary failure. Instead each resolves a
 * discriminated union so callers branch on `outcome.kind` — never on response
 * text, and never on a caught error's shape. The distinct outcomes the UI needs
 * are exactly the distinct transports: **2xx**, **403** (authenticated but not a
 * lead, AC-18), **401** (no session — route to `/signin`), and *everything
 * else*, with an unreachable API (`fetch` rejecting with a `TypeError`) kept
 * distinct from an HTTP error so a retry hint can be honest.
 */

import {
  apiGet,
  apiPost,
  isApiError,
  type ApiFetchOptions,
  type Kudos,
} from "../api-client";

/** Copy the confirm action shows while the hide request is in flight. */
export const HIDING_MESSAGE = "Hiding…";

/** Toast copy once a kudos is hidden (AC-17 / AC-19 convergence). */
export const HIDDEN_FROM_BOARD_TOAST = "Hidden from the board for everyone.";

/** Inline notice when the API answers 403 — the defensive state (AC-18). */
export const HIDE_FORBIDDEN_MESSAGE = "Only team leads can hide kudos.";

/** Inline notice for every other hide failure; the card is left unchanged. */
export const HIDE_FAILED_MESSAGE = "Couldn't hide that kudos. Try again.";

/** Where a 401 sends the member — mirrors `middleware.ts`. */
export const SIGN_IN_PATH = "/signin";

/** Copy when a member session asks for the lead-only hidden list. */
export const HIDDEN_LIST_FORBIDDEN_MESSAGE =
  "Only team leads can review hidden kudos.";

/** Copy when the hidden list cannot be loaded. */
export const HIDDEN_LIST_FAILED_MESSAGE = "Couldn't load hidden kudos.";

/**
 * A kudos as the lead-only `?hidden=true` variant returns it: the uniform
 * ADR-7 resource plus the soft-hide audit fields (ADR-5).
 *
 * `hiddenBy` is the member id of who hid it, or `null` when the API cannot
 * attribute it — the key is always present so consumers can rely on the shape.
 */
export interface HiddenKudos extends Kudos {
  readonly hiddenAt: string;
  readonly hiddenBy: string | null;
}

/** One page of the lead-only hidden review list. */
export interface HiddenKudosPage {
  readonly items: readonly HiddenKudos[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/** Why a hide attempt did not land, beyond "not allowed" and "not signed in". */
export type HideFailureReason = "network" | "unknown";

/**
 * Every distinct way `POST /kudos/:id/hide` can end.
 *
 * - `"hidden"`      2xx — the kudos is soft-hidden; the caller removes the card.
 * - `"forbidden"`   403 — the session is not a lead (AC-18).
 * - `"unauthorized"` 401 — no valid session; the caller routes to `/signin`.
 * - `"failed"`      anything else, including an unreachable API.
 */
export type HideKudosOutcome =
  | { readonly kind: "hidden"; readonly kudosId: string }
  | { readonly kind: "forbidden"; readonly kudosId: string }
  | { readonly kind: "unauthorized"; readonly kudosId: string }
  | {
      readonly kind: "failed";
      readonly kudosId: string;
      readonly reason: HideFailureReason;
    };

/**
 * Every distinct way the hidden list request can end. `page` is present only on
 * `"ok"` because it is the only outcome that rendered anything.
 */
export type HiddenKudosListOutcome =
  | { readonly kind: "ok"; readonly page: HiddenKudosPage }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "failed"; readonly reason: HideFailureReason };

/** Transport-level knobs `hideKudos` still allows (cookie, signal, baseUrl…). */
export type HideKudosOptions = Omit<ApiFetchOptions, "method" | "body">;

/** Transport-level knobs `listHiddenKudos` still allows. */
export type ListHiddenKudosOptions = Omit<ApiFetchOptions, "method" | "body">;

/** True when the thrown value is a `fetch`-level failure (unreachable API). */
function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

/**
 * Soft-hides one kudos (EP-6).
 *
 * The kudos row and its reactions are retained server-side (ADR-5) — only the
 * hidden flag is set, which is what removes it from `GET /api/v1/kudos` for
 * every member. Hiding an already-hidden kudos is still a 2xx, so the outcome
 * is idempotent from this side too.
 *
 * Resolves — never rejects — with a {@link HideKudosOutcome}.
 */
export async function hideKudos(
  kudosId: string,
  options: HideKudosOptions = {},
): Promise<HideKudosOutcome> {
  const path = `/kudos/${encodeURIComponent(kudosId)}/hide`;

  try {
    await apiPost<{ id?: string }>(path, undefined, options);
    return { kind: "hidden", kudosId };
  } catch (error) {
    if (isApiError(error)) {
      if (error.isForbidden) return { kind: "forbidden", kudosId };
      if (error.isUnauthorized) return { kind: "unauthorized", kudosId };
      return { kind: "failed", kudosId, reason: "unknown" };
    }
    return {
      kind: "failed",
      kudosId,
      reason: isNetworkFailure(error) ? "network" : "unknown",
    };
  }
}

/** Defaults/normalises the 1-based page number of the hidden list. */
function normalizePage(page: number | undefined): number {
  if (page === undefined || !Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

/**
 * Fills in the soft-hide audit fields defensively, so a row that ever arrived
 * without them still renders a real timestamp instead of `undefined`.
 */
function toHiddenKudos(item: Kudos & Partial<HiddenKudos>): HiddenKudos {
  return {
    ...item,
    hiddenAt:
      typeof item.hiddenAt === "string" && item.hiddenAt.length > 0
        ? item.hiddenAt
        : item.createdAt,
    hiddenBy: typeof item.hiddenBy === "string" ? item.hiddenBy : null,
  };
}

/**
 * Lists one page of the soft-hidden kudos — the lead-only review view behind
 * the `Hidden only` toggle.
 *
 * The query string is exactly `hidden=true&page=N`; nothing else is sent, so
 * the page size stays the server's fixed 20 (ADR-6) and the filter cannot be
 * widened by the client.
 *
 * Resolves — never rejects — with a {@link HiddenKudosListOutcome}: a member
 * session gets `"forbidden"`, a missing session gets `"unauthorized"`, and an
 * unreachable API gets `"failed"` with `reason: "network"`.
 */
export async function listHiddenKudos(
  page = 1,
  options: ListHiddenKudosOptions = {},
): Promise<HiddenKudosListOutcome> {
  const query = new URLSearchParams({
    hidden: "true",
    page: String(normalizePage(page)),
  });

  try {
    const body = await apiGet<HiddenKudosPage>(
      `/kudos?${query.toString()}`,
      options,
    );

    const items = Array.isArray(body.items) ? body.items : [];
    return {
      kind: "ok",
      page: {
        items: items.map(toHiddenKudos),
        page: typeof body.page === "number" ? body.page : normalizePage(page),
        pageSize:
          typeof body.pageSize === "number" ? body.pageSize : items.length,
        total: typeof body.total === "number" ? body.total : items.length,
      },
    };
  } catch (error) {
    if (isApiError(error)) {
      if (error.isForbidden) return { kind: "forbidden" };
      if (error.isUnauthorized) return { kind: "unauthorized" };
      return { kind: "failed", reason: "unknown" };
    }
    return {
      kind: "failed",
      reason: isNetworkFailure(error) ? "network" : "unknown",
    };
  }
}
