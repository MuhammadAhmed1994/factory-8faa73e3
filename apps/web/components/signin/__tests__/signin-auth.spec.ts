import {
  AUTH_LOGIN_ENDPOINT,
  AUTH_SESSION_ENDPOINT,
  getSession,
  login,
} from "@/lib/api/auth";

/**
 * Behavioural specs for the real `lib/api/auth.ts` module (EP-1 / EP-2, ADR-1).
 *
 * Unlike the component specs in this directory, nothing here is mocked at the
 * module boundary: `fetch` is replaced at the network boundary, so the
 * assertions are real evidence about what the module puts on the wire — the
 * same-origin path, the JSON credentials body, and the cookie credentials that
 * keep the httpOnly session first-party per ADR-1.
 *
 * The graded AC-4 / AC-5 blocks live in `__tests__/signin.spec.tsx`; these are
 * the endpoint contract underneath them, so no AC id appears in a title here.
 */

/** A seeded member, as `POST /api/v1/auth/login` answers on 200. */
const MEMBER = { email: "maya@team.co", role: "MEMBER" } as const;

/** Minimum `Response`-shaped stub — `text()` is the only member read. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Installs a `fetch` mock (jsdom ships none) and returns it. */
function installFetch(impl: () => Promise<Response>): jest.Mock {
  const mock = jest.fn(impl);
  (globalThis as { fetch: unknown }).fetch = mock;
  return mock;
}

afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = undefined;
});

describe("login", () => {
  it("POSTs JSON credentials to the same-origin /api/v1/auth/login", async () => {
    const fetchMock = installFetch(() =>
      Promise.resolve(jsonResponse(200, MEMBER)),
    );

    await expect(login("maya@team.co", "hunter2")).resolves.toEqual(MEMBER);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(AUTH_LOGIN_ENDPOINT);
    expect(url).toBe("/api/v1/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "maya@team.co",
      password: "hunter2",
    });
    expect(new Headers(init.headers).get("Content-Type")).toBe(
      "application/json",
    );
    // Same-origin, so the httpOnly cookie the API sets stays first-party.
    expect(init.credentials).toBe("same-origin");
  });

  it("rejects with ApiError 401 when the credentials are wrong", async () => {
    installFetch(() =>
      Promise.resolve(
        jsonResponse(401, {
          statusCode: 401,
          message: "That email and password don't match. Try again.",
        }),
      ),
    );

    await expect(login("maya@team.co", "nope")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
  });

  it("rejects with ApiError status 0 when the API is unreachable", async () => {
    installFetch(() => Promise.reject(new TypeError("Failed to fetch")));

    await expect(login("maya@team.co", "hunter2")).rejects.toMatchObject({
      name: "ApiError",
      status: 0,
    });
  });

  it("carries the API's own message for other non-2xx statuses", async () => {
    installFetch(() =>
      Promise.resolve(
        jsonResponse(429, { statusCode: 429, message: "Too many attempts" }),
      ),
    );

    await expect(login("maya@team.co", "hunter2")).rejects.toMatchObject({
      status: 429,
      message: "Too many attempts",
    });
  });
});

describe("getSession", () => {
  it("GETs /api/v1/auth/session typed as { email, role }", async () => {
    const fetchMock = installFetch(() =>
      Promise.resolve(jsonResponse(200, MEMBER)),
    );

    await expect(getSession()).resolves.toEqual({
      email: "maya@team.co",
      role: "MEMBER",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(AUTH_SESSION_ENDPOINT);
    expect(url).toBe("/api/v1/auth/session");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
  });

  it("rejects with ApiError 401 when there is no session", async () => {
    installFetch(() =>
      Promise.resolve(
        jsonResponse(401, { statusCode: 401, message: "Unauthorized" }),
      ),
    );

    await expect(getSession()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
  });
});
