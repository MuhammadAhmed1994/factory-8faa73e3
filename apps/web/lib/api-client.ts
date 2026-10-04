/**
 * Typed fetch wrapper for the Team Kudos Board NestJS API (ADR-1: the session
 * is an httpOnly cookie resolved server-side; no bearer tokens anywhere).
 *
 * Usage notes for callers:
 *
 * - 401 → redirect to `/signin` (the session is missing/invalid).
 * - 403 → render the lead-only notice ("Only team leads can hide kudos").
 * - 400 → surface the payload's field messages as inline errors.
 *
 * The base URL is code-defaulted to the local API and overridable through the
 * `API_BASE_URL` env var — no `.env` file is owned by this repo.
 */

/** Name of the httpOnly session cookie issued by `POST /api/v1/auth/login`. */
export const SESSION_COOKIE_NAME = "kudos_session";

/** Default NestJS origin + versioned API prefix. */
export const DEFAULT_API_BASE_URL = "http://localhost:3000/api/v1";

/** Board page size (constraint C-3 / ADR-6). */
export const KUDOS_PAGE_SIZE = 20;

/** Board refresh interval (ADR-3: 15s polling, no SSE/WebSocket). */
export const BOARD_POLL_INTERVAL_MS = 15_000;

/**
 * Resolves the API base URL. `override` wins, then `process.env.API_BASE_URL`,
 * then the code default — so tests and callers can point the client anywhere
 * without owning a `.env` file.
 */
export function resolveApiBaseUrl(override?: string): string {
  const fromEnv = process.env.API_BASE_URL;
  const candidate = override?.trim() || fromEnv?.trim() || "";
  if (candidate.length > 0) {
    // Strip a trailing slash so `${base}/kudos` is always well-formed.
    return candidate.replace(/\/+$/, "");
  }
  return DEFAULT_API_BASE_URL;
}

/** Member roles as seeded on the member row (ADR-2). */
export type MemberRole = "MEMBER" | "LEAD";

/** Signed-in member as returned by `GET /api/v1/auth/session` (ADR-1). */
export interface SessionMember {
  email: string;
  role: MemberRole;
}

/** `author { id, email }` on the uniform kudos resource (ADR-7). */
export interface KudosAuthor {
  id: string;
  email: string;
}

/** Aggregated reaction on a kudos (ADR-4 / ADR-7). */
export interface KudosReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

/** Uniform kudos resource returned by list, create and react (ADR-7). */
export interface Kudos {
  id: string;
  recipient: string;
  message: string;
  author: KudosAuthor;
  createdAt: string;
  reactions: KudosReaction[];
}

/** Paginated board envelope: `{ data: Kudos[], page, pageSize, total }`. */
export interface KudosPage {
  data: Kudos[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Error thrown for any non-2xx API response.
 *
 * Carries the HTTP `status` plus a single `message` string, and keeps the parsed
 * body so callers can map 400s onto specific inline field errors.
 */
export class ApiError extends Error {
  readonly status: number;
  /** Parsed JSON body when the response was JSON, else `undefined`. */
  readonly body: unknown;
  /** Field-level messages extracted from a NestJS 400 payload, if any. */
  readonly fields: Record<string, string>;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.fields = extractFieldErrors(body);
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isValidation(): boolean {
    return this.status === 400;
  }
}

/** Best-effort single human-readable message out of a JSON error body. */
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

/** NestJS `ValidationPipe` failures may arrive as `[{ property, constraints }]`. */
function extractFieldErrors(body: unknown): Record<string, string> {
  if (!isRecord(body)) {
    return {};
  }
  const fields: Record<string, string> = {};
  const message = body.message;
  if (Array.isArray(message)) {
    for (const entry of message) {
      if (!isRecord(entry)) {
        continue;
      }
      const property = entry.property;
      if (typeof property !== "string" || property.length === 0) {
        continue;
      }
      const constraints = entry.constraints;
      if (isRecord(constraints)) {
        const first = Object.values(constraints).find(
          (value): value is string => typeof value === "string",
        );
        if (first !== undefined) {
          fields[property] = first;
          continue;
        }
      }
      fields[property] = `Invalid value for ${property}`;
    }
  }
  if (isRecord(body.errors)) {
    for (const [key, value] of Object.entries(body.errors)) {
      if (typeof value === "string") {
        fields[key] = value;
      }
    }
  }
  return fields;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

/** Options accepted by {@link apiFetch}. */
export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** JSON-serialisable request body; `undefined` sends no body. */
  body?: unknown;
  /** Force a different API base URL for this call (tests / storybook). */
  baseUrl?: string;
  /** Explicit cookie header; defaults to forwarding the caller's. */
  cookie?: string;
}

/**
 * Performs a typed JSON request against the API.
 *
 * - Forwards the httpOnly session cookie (`credentials: "include"` on the
 *   browser; an explicit `Cookie` header server-side, where Next's fetch does
 *   not forward incoming cookies automatically).
 * - Parses the JSON body of every response, 2xx or not.
 * - Throws {@link ApiError} with `status` + `message` for any non-2xx response
 *   so callers can branch on 401 / 403 / 400.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { body, baseUrl, cookie, headers, ...rest } = options;

  const base = resolveApiBaseUrl(baseUrl);
  const url = path.startsWith("http")
    ? path
    : `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const requestHeaders = new Headers(headers);
  if (body !== undefined && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }
  if (typeof cookie === "string" && cookie.length > 0) {
    requestHeaders.set("Cookie", cookie);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: rest.credentials ?? "include",
      cache: rest.cache ?? "no-store",
    });
  } catch (cause) {
    // Network-level failure: surface it as an ApiError so callers have one
    // catch path, but keep the cause for debugging.
    throw new ApiError(
      0,
      cause instanceof Error ? cause.message : "Network request failed",
      { cause: String(cause) },
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
    throw new ApiError(response.status, readErrorMessage(response.status, parsed), parsed);
  }

  return parsed as T;
}

/** `GET /api/v1/auth/session` → the signed-in member (ADR-1). */
export function getSession(cookie?: string): Promise<SessionMember> {
  return apiFetch<SessionMember>("/auth/session", { cookie });
}

/** `GET /api/v1/kudos?page=N` → newest-first board page (ADR-6). */
export function getKudosPage(
  page = 1,
  cookie?: string,
): Promise<KudosPage | Kudos[]> {
  return apiFetch<KudosPage | Kudos[]>(`/kudos?page=${page}`, { cookie });
}

/** `POST /api/v1/kudos` → the created kudos (AC-6). */
export function postKudos(
  input: { recipient: string; message: string },
  cookie?: string,
): Promise<Kudos> {
  return apiFetch<Kudos>("/kudos", { method: "POST", body: input, cookie });
}
