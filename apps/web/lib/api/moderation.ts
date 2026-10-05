import {
  ApiError,
  apiFetch,
  type Kudos,
  type KudosAuthor,
  type KudosReaction,
  type MemberRole,
} from "@/lib/api-client";

/**
 * Moderation API surface for the web app (EP-6 `POST /api/v1/kudos/:id/hide`,
 * plus the lead-only review variant `GET /api/v1/kudos?hidden=true&page=N`).
 *
 * Both calls go through the **shared** client (`lib/api-client.ts`), which owns
 * base-URL resolution, the httpOnly session cookie (`credentials: "include"`)
 * and the `ApiError` mapping. This module never talks to `fetch` directly; it
 * only translates the API's outcomes into the distinct UI states the hide
 * control needs:
 *
 * | API outcome              | `kind`              | designed copy                              |
 * |--------------------------|---------------------|--------------------------------------------|
 * | 2xx                      | — (`ok: true`)      | "Hidden from the board for everyone."      |
 * | 403 (not a lead)         | `forbidden`         | "Only team leads can hide kudos."          |
 * | 401 (no session)         | `unauthenticated`   | "Please sign in again."                    |
 * | network unreachable      | `network`           | "Couldn't hide that kudos. Try again."     |
 * | anything else (404, 5xx) | `error`             | "Couldn't hide that kudos. Try again."     |
 *
 * No outcome is ever thrown: a rejected request is data here, not an exception
 * the board has to catch, so the popover's state machine stays a plain switch.
 *
 * The hidden-only list returns the standard ADR-7 kudos shape **plus**
 * `hiddenAt`/`hiddenBy` (the one variant that exposes hidden state — see
 * `SerializedKudosWithHiddenState` on the API side).
 */

/* -------------------------------------------------------------------------- */
/* Copy pinned by scr-board-lead                                              */
/* -------------------------------------------------------------------------- */

/** Accessible name of the ghost eye-off trigger on each card (a11y spec). */
export const HIDE_CONTROL_LABEL = "Hide this kudos from the board";

/** The destructive confirm action inside the popover. */
export const HIDE_CONFIRM_ACTION_LABEL = "Hide from board";

/** Popover title / body copy (microcopy: "Hiding removes a kudos …"). */
export const HIDE_CONFIRM_TITLE = "Hide this kudos?";
export const HIDE_CONFIRM_BODY =
  "Hiding removes a kudos from the board for everyone. There is no undo.";

/** Quiet cancel affordance of the confirm popover. */
export const HIDE_CANCEL_LABEL = "Cancel";

/** In-flight state of the confirm action ("Hiding — in progress"). */
export const HIDING_LABEL = "Hiding…";

/** Defensive 403 notice (designed even though members never see the control). */
export const HIDE_FORBIDDEN_MESSAGE = "Only team leads can hide kudos.";

/** Any other failure of the hide action — retry stays available. */
export const HIDE_FAILED_MESSAGE = "Couldn't hide that kudos. Try again.";

/** Success toast; the card itself already faded out of the list. */
export const HIDDEN_TOAST_MESSAGE = "Hidden from the board for everyone.";

/** 401 from any moderation call — the board routes to `/signin`. */
export const MODERATION_SIGNIN_MESSAGE = "Please sign in again.";

/** Visible label of the "Hidden only" filter chip. */
export const HIDDEN_ONLY_LABEL = "Hidden only";

/** Accessible name of the switch (matches the scr-board-lead markup). */
export const HIDDEN_TOGGLE_LABEL =
  "Hidden only — show kudos hidden from the board";

/** Quiet caption under the chip. */
export const HIDDEN_TOGGLE_HINT = "Hidden kudos stay visible to leads only.";

/** Empty state of the hidden-only view (cmp-empty-state, `hidden-empty`). */
export const HIDDEN_EMPTY_MESSAGE =
  "Nothing hidden. The board is a nice place today.";

/** Badge text on a dimmed, already-hidden card. */
export const HIDDEN_BADGE_LABEL = "Hidden";

/** Failures of the hidden-only list read. */
export const HIDDEN_LIST_FORBIDDEN_MESSAGE =
  "Only team leads can review hidden kudos.";
export const HIDDEN_LIST_FAILED_MESSAGE = "Couldn't load hidden kudos.";

/**
 * Exit fade of a successfully hidden card (scr-board-lead: "card fades out of
 * the list (200ms)"). Exported so the board and the hide control agree on one
 * number — the board removes the card after exactly this long.
 */
export const KUDOS_EXIT_FADE_MS = 200;

/**
 * True when the session role is the lead role (ADR-2: the role is seeded on the
 * member row). Gates every moderation affordance — callers render nothing at
 * all for members, never a CSS-hidden control.
 */
export function isLeadRole(role: MemberRole | null | undefined): boolean {
  return role === "LEAD";
}

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The lead-only review variant of the kudos resource: the standard ADR-7 shape
 * plus the soft-hide bookkeeping. `hiddenBy` is `null` in v1 — the schema keeps
 * only `hiddenAt` — so the type is honest about the absence rather than
 * inventing an attribution.
 */
export interface HiddenKudos extends Kudos {
  readonly hiddenAt: string | null;
  readonly hiddenBy: string | null;
}

/** Body of a successful `POST /api/v1/kudos/:id/hide` — just the hidden id. */
export interface HiddenKudosAck {
  readonly id: string;
}

/** Accepted payload shapes of `GET /api/v1/kudos?hidden=true&page=N`. */
export type HiddenKudosPayload = HiddenKudos[] | HiddenKudosPageEnvelope;

/** Paginated envelope, should the API start returning one. */
export interface HiddenKudosPageEnvelope {
  readonly data?: unknown;
  readonly page?: number;
  readonly pageSize?: number;
  readonly total?: number;
}

/** Why a moderation call failed — one distinct UI state per kind. */
export type ModerationFailureKind =
  | "forbidden"
  | "unauthenticated"
  | "network"
  | "error";

/** The single failure shape both moderation calls resolve with. */
export interface ModerationFailure {
  readonly ok: false;
  readonly kind: ModerationFailureKind;
  /** Designed copy for the failing state, ready to render. */
  readonly message: string;
}

/** `POST /kudos/:id/hide` → 2xx. */
export interface HideKudosSuccess {
  readonly ok: true;
  /** The id that was hidden; handed straight to `onHidden`. */
  readonly kudosId: string;
}

/** Never throws: every non-2xx becomes a {@link ModerationFailure}. */
export type HideKudosOutcome = HideKudosSuccess | ModerationFailure;

/** `GET /kudos?hidden=true&page=N` → 2xx. */
export interface ListHiddenKudosSuccess {
  readonly ok: true;
  /** The page that was requested (clamped to >= 1). */
  readonly page: number;
  /** Soft-hidden kudos, newest first, as the API returned them. */
  readonly kudos: HiddenKudos[];
}

/** Never throws: 403 / 401 / network / other each become their own kind. */
export type ListHiddenKudosOutcome =
  | ListHiddenKudosSuccess
  | ModerationFailure;

/* -------------------------------------------------------------------------- */
/* Mapping                                                                     */
/* -------------------------------------------------------------------------- */

/** Copy pair a caller supplies so each action keeps its own designed message. */
interface FailureCopy {
  readonly forbidden: string;
  readonly fallback: string;
}

/**
 * Maps one rejected moderation call onto the distinct UI outcomes.
 *
 * `ApiError.status === 0` is the shared client's network-level failure (fetch
 * threw), which stays separate from a real HTTP error so the UI can say
 * "try again" for a dead network and something more specific for a 404/5xx.
 */
function toModerationFailure(
  cause: unknown,
  copy: FailureCopy,
): ModerationFailure {
  if (cause instanceof ApiError) {
    if (cause.isForbidden) {
      return { ok: false, kind: "forbidden", message: copy.forbidden };
    }
    if (cause.isUnauthenticated) {
      return {
        ok: false,
        kind: "unauthenticated",
        message: MODERATION_SIGNIN_MESSAGE,
      };
    }
    if (cause.status === 0) {
      return { ok: false, kind: "network", message: copy.fallback };
    }
    return { ok: false, kind: "error", message: copy.fallback };
  }

  // Anything that is not an ApiError can only be an unexpected client bug —
  // treat it like an unreachable network rather than crashing the popover.
  return { ok: false, kind: "network", message: copy.fallback };
}

/** Clamps a requested page onto the 1-based sequence (mirrors the API). */
export function normaliseModerationPage(page: number): number {
  if (!Number.isFinite(page)) {
    return 1;
  }
  const clamped = Math.trunc(page);
  return clamped >= 1 ? clamped : 1;
}

/** `author { id, email }` guard for defensive normalisation. */
function isKudosAuthor(value: unknown): value is KudosAuthor {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.email === "string";
}

/**
 * Normalises one review-variant row.
 *
 * Nothing the board renders is invented: a missing `reactions` array becomes
 * `[]` (ADR-7's legitimate "no reactions" case) and a missing
 * `hiddenAt`/`hiddenBy` becomes `null`. A row without an id/recipient/message
 * cannot be rendered as a card at all, so it is dropped rather than half-shown.
 */
function toHiddenKudos(row: unknown): HiddenKudos | null {
  if (typeof row !== "object" || row === null) {
    return null;
  }
  const record = row as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    typeof record.recipient !== "string" ||
    typeof record.message !== "string"
  ) {
    return null;
  }

  return {
    id: record.id,
    recipient: record.recipient,
    message: record.message,
    author: isKudosAuthor(record.author)
      ? record.author
      : { id: "", email: "" },
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date(0).toISOString(),
    reactions: Array.isArray(record.reactions)
      ? (record.reactions as KudosReaction[])
      : [],
    hiddenAt: typeof record.hiddenAt === "string" ? record.hiddenAt : null,
    hiddenBy: typeof record.hiddenBy === "string" ? record.hiddenBy : null,
  };
}

/**
 * Reads the hidden-kudos array out of a review-variant payload, accepting the
 * bare array the API returns today as well as the paginated envelope.
 */
export function readHiddenKudos(payload: HiddenKudosPayload): HiddenKudos[] {
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : [];

  const out: HiddenKudos[] = [];
  for (const row of rows) {
    const hidden = toHiddenKudos(row);
    if (hidden !== null) {
      out.push(hidden);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Calls                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `POST /api/v1/kudos/:id/hide` (EP-6) — soft-hide one kudos (ADR-5).
 *
 * Sends no body (the endpoint takes none) and forwards the httpOnly session
 * cookie through the shared client, so the API's `RolesGuard` sees the caller's
 * seeded role. Resolves with:
 *
 * - `{ ok: true, kudosId }` on **2xx** — the caller removes the card and fires
 *   the success toast (AC-17 / AC-19);
 * - `{ ok: false, kind: "forbidden" }` on **403** — a signed-in member who is
 *   not a lead; the popover stays open with the info notice (AC-18);
 * - `{ ok: false, kind: "unauthenticated" }` on **401** — route to `/signin`;
 * - `{ ok: false, kind: "network" | "error" }` otherwise — retry available.
 */
export async function hideKudos(kudosId: string): Promise<HideKudosOutcome> {
  if (typeof kudosId !== "string" || kudosId.length === 0) {
    // Nothing to ask the API about; a card without an id cannot be hidden.
    return { ok: false, kind: "error", message: HIDE_FAILED_MESSAGE };
  }

  try {
    await apiFetch<HiddenKudosAck>(
      `/kudos/${encodeURIComponent(kudosId)}/hide`,
      { method: "POST" },
    );
    return { ok: true, kudosId };
  } catch (cause) {
    return toModerationFailure(cause, {
      forbidden: HIDE_FORBIDDEN_MESSAGE,
      fallback: HIDE_FAILED_MESSAGE,
    });
  }
}

/**
 * `GET /api/v1/kudos?hidden=true&page=N` — the lead-only review variant that
 * the "Hidden only" toggle flips the board to (scr-board-lead's binding).
 *
 * The query string is built here so the hidden view can never be requested by
 * accident: the normal board keeps calling `getKudosPage`, which never sends
 * `hidden=true`, which is why a member's list never contains a hidden kudos.
 *
 * Resolves with the standard kudos shape plus `hiddenAt`/`hiddenBy` on **2xx**;
 * a **403** (regular member), **401**, network failure and any other error each
 * map to their own `kind`.
 */
export async function listHiddenKudos(
  page = 1,
): Promise<ListHiddenKudosOutcome> {
  const safePage = normaliseModerationPage(page);

  try {
    const payload = await apiFetch<HiddenKudosPayload>(
      `/kudos?hidden=true&page=${safePage}`,
    );
    return { ok: true, page: safePage, kudos: readHiddenKudos(payload) };
  } catch (cause) {
    return toModerationFailure(cause, {
      forbidden: HIDDEN_LIST_FORBIDDEN_MESSAGE,
      fallback: HIDDEN_LIST_FAILED_MESSAGE,
    });
  }
}
