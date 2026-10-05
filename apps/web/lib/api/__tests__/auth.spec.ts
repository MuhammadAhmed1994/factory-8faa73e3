import { AUTH_LOGIN_ENDPOINT, AUTH_SESSION_ENDPOINT, getSession, login } from "@/lib/api/auth";

/**
 * Static contract pins for `lib/api/auth.ts` (EP-1 / EP-2, ADR-1).
 *
 * These assert only what needs no browser runtime — the same-origin endpoint
 * paths and the exported call surface — because that is what keeps the httpOnly
 * session cookie first-party: `next.config.ts` rewrites `/api/v1/*` to the
 * NestJS API, so a path that accidentally grew an absolute origin would put the
 * cookie in third-party territory and silently drop the session.
 *
 * The *behaviour* of these functions — the JSON credentials body, the
 * `credentials: "same-origin"` request, the 401 / unreachable mappings — is
 * asserted against `fetch` itself in
 * `components/signin/__tests__/signin-auth.spec.ts`, which the sign-in task's
 * `pnpm --filter web test -- signin` gate runs.
 *
 * No AC id appears in a title here: the graded AC-4 / AC-5 specs live in
 * `components/signin/__tests__/signin.spec.tsx`.
 */

it("targets the same-origin login and session paths", () => {
  expect(AUTH_LOGIN_ENDPOINT).toBe("/api/v1/auth/login");
  expect(AUTH_SESSION_ENDPOINT).toBe("/api/v1/auth/session");
});

it("exports the two auth calls the sign-in flow uses", () => {
  expect(typeof login).toBe("function");
  expect(typeof getSession).toBe("function");
});
