/**
 * Typed fetch wrapper around the NestJS API.
 *
 * The base URL defaults to `http://localhost:3000/api/v1` and is resolved *in
 * code* — this package owns no `.env` file. Callers may override it per call
 * (`baseUrl`) or for the whole app (`NEXT_PUBLIC_API_BASE_URL`).
 *
 * Every response that is not 2xx becomes an {@link ApiError} carrying the HTTP
 * `status` plus a readable `message`, so callers can branch on status rather
 * than response text:
 *
 * - 401 → redirect to `/signin`
 * - 403 → lead-only notice
 * - 400 → inline field errors
 */

/** Default base URL of the NestJS API (no `.env` file is owned or read). */
export const DEFAULT_API_BASE_URL = "http://localhost:3000/api/v1";

/** Cookie that references the server-side session (ADR-1). */
export const DEFAULT_SESSION_COOKIE_NAME = "kudos_session";

/** Copy used when the API answers 401 — the caller should send the member to `/signin`. */
export const UNAUTHORIZED_MESSAGE = "Please sign in again";

/** Copy used when the API answers 403 on a lead-only action (hide kudos). */
export const FORBIDDEN_MESSAGE = "Only team leads can hide kudos";

/** Copy used when the API answers 400 with a validation problem. */
export const VALIDATION_MESSAGE = "That message is too long";

/** Roles a member can hold; leads are seeded with `LEAD` (ADR-2). */
export type MemberRole = "MEMBER" | "LEAD";

/** Signed-in member as exposed by `GET /api/v1/auth/session` (ADR-1). */
export interface SessionMember {
  readonly email: string;
  readonly role: MemberRole;
}

/** Author embedded in every kudos response (ADR-7). */
export interface KudosAuthor {
  readonly id: string;
  readonly email: string;
}

/** One aggregated reaction on a kudos (ADR-4/ADR-7). */
export interface ReactionSummary {
  readonly emoji: string;
  readonly count: number;
  readonly mine: boolean;
}

/** The uniform kudos resource returned by list, create and react (ADR-7). */
export interface Kudos {
  readonly id: string;
  readonly recipient: string;
  readonly message: string;
  readonly author: KudosAuthor;
  readonly createdAt: string;
  readonly reactions: readonly ReactionSummary[];
}

/** Page of the board, newest first, 20 per page (ADR-6). */
export interface KudosPage {
  readonly items: readonly Kudos[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/** Error body shape produced by NestJS: `{ statusCode, message, error? }`. */
export interface ApiErrorBody {
  readonly statusCode?: number;
  readonly message?: string | readonly string[];
  readonly error?: string;
}

/**
 * Typed error thrown for every non-2xx API response.
 *
 * `message` is a single human-readable line (the first of NestJS' messages);
 * `messages` keeps all of them so a 400 can be mapped onto inline field errors.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly messages: readonly string[];
  readonly body: ApiErrorBody | null;

  constructor(
    status: number,
    messages: readonly string[],
    body: ApiErrorBody | null = null,
  ) {
    super(messages.length > 0 ? messages.join(" ") : `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.messages = messages;
    this.body = body;
  }

  /** True when the API refused the request because there is no valid session. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** True when the caller's role is not allowed to perform the action. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** True when the submitted payload failed validation (inline field errors). */
  get isValidationFailure(): boolean {
    return this.status === 400;
  }
}

/** Narrows an unknown thrown value to {@link ApiError}. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** True when `error` is an {@link ApiError} with exactly `status`. */
export function hasStatus(error: unknown, status: number): boolean {
  return isApiError(error) && error.status === status;
}

/** Best-effort human-readable message for any thrown value. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (isApiError(error)) {
    return error.messages.length > 0 ? error.messages.join(" ") : fallback;
  }
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  return fallback;
}

/** Resolves the API base URL: an explicit argument wins, then the env var, then the default. */
export function getApiBaseUrl(explicit?: string): string {
  const candidate = explicit ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  const trimmed = candidate?.trim();
  return (trimmed && trimmed.length > 0 ? trimmed : DEFAULT_API_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

/**
 * Name of the httpOnly session cookie. Mirrors the API's `SESSION_COOKIE_NAME`
 * override so both halves of the monorepo can be pointed at a different cookie.
 */
export function getSessionCookieName(): string {
  const fromEnv = process.env.SESSION_COOKIE_NAME?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_SESSION_COOKIE_NAME;
}

/** Serialises the session cookie for a server-side `Cookie` request header. */
export function sessionCookieHeader(token: string): string {
  return `${getSessionCookieName()}=${token}`;
}

/** HTTP methods the client needs. */
export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiFetchOptions {
  /** Defaults to `GET`. */
  readonly method?: ApiMethod;
  /** JSON-serialised request body. */
  readonly body?: unknown;
  /**
   * Raw `Cookie` header value, e.g. from `sessionCookieHeader(token)`. Server
   * components pass this to forward the httpOnly session cookie (ADR-1); in the
   * browser the cookie rides along via `credentials: "include"` instead.
   */
  readonly cookie?: string | null;
  /** Extra headers merged over the defaults. */
  readonly headers?: Record<string, string>;
  /** Aborts the underlying fetch. */
  readonly signal?: AbortSignal;
  /** Per-call base URL override. */
  readonly baseUrl?: string;
  /** Next.js fetch cache mode. */
  readonly cache?: RequestCache;
  /** Next.js revalidation window in seconds, or `false` to never revalidate. */
  readonly revalidate?: number | false;
}

/** `RequestInit` extended with Next.js' fetch options. */
type NextFetchInit = RequestInit & {
  next?: { revalidate?: number | false; tags?: string[] };
};

/** Reads a JSON body without throwing on an empty one. */
async function readJsonBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    const text = await response.text();
    if (text.trim() === "") return null;
    return JSON.parse(text) as ApiErrorBody;
  } catch {
    return null;
  }
}

/** Flattens NestJS' `message` (a string or an array of strings) into lines. */
function toMessages(body: ApiErrorBody | null, status: number): string[] {
  const raw = body?.message;
  if (typeof raw === "string" && raw.trim() !== "") return [raw.trim()];
  if (Array.isArray(raw)) {
    const lines = raw.filter(
      (line): line is string => typeof line === "string" && line.trim() !== "",
    );
    if (lines.length > 0) return lines;
  }
  if (body?.error) return [body.error];
  return [`Request failed (${status})`];
}

/**
 * Performs a JSON request against the API and returns the parsed body.
 *
 * @throws {ApiError} for every non-2xx response.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const {
    method = "GET",
    body,
    cookie,
    headers,
    signal,
    cache,
    revalidate,
  } = options;

  const base = getApiBaseUrl(options.baseUrl);
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const requestHeaders: Record<string, string> = {
    Accept: "application/json",
    ...headers,
  };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (cookie) requestHeaders["Cookie"] = cookie;

  const init: NextFetchInit = {
    method,
    headers: requestHeaders,
    credentials: "include",
    ...(cache !== undefined ? { cache } : {}),
    ...(revalidate !== undefined ? { next: { revalidate } } : {}),
    ...(signal !== undefined ? { signal } : {}),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  const response = await fetch(url, init);

  if (!response.ok) {
    const body = await readJsonBody(response);
    throw new ApiError(response.status, toMessages(body, response.status), body);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (text.trim() === "") return undefined as T;
  return JSON.parse(text) as T;
}

/** `GET` a resource. */
export function apiGet<T = unknown>(
  path: string,
  options: Omit<ApiFetchOptions, "method" | "body"> = {},
): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "GET" });
}

/** `POST` a JSON body. */
export function apiPost<T = unknown>(
  path: string,
  body?: unknown,
  options: Omit<ApiFetchOptions, "method" | "body"> = {},
): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "POST", body });
}

/** `PUT` a JSON body (upsert-replace reaction, ADR-4). */
export function apiPut<T = unknown>(
  path: string,
  body?: unknown,
  options: Omit<ApiFetchOptions, "method" | "body"> = {},
): Promise<T> {
  return apiFetch<T>(path, { ...options, method: "PUT", body });
}
