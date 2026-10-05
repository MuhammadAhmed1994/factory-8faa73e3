/**
 * Environment contract for jest module resolution in `apps/web`.
 *
 * Born as a scratch probe while wiring the sign-in specs (T-12) and kept
 * because this workspace cannot delete a file once created — so it pins the
 * finding instead of discarding it:
 *
 * `next/jest` resolves the `@/*` path alias for **`import` / `require`
 * statements** but not for **`jest.mock()`'s own resolution step**. A call like
 * `jest.mock("@/lib/api/auth", …)` throws "Cannot find module", while the same
 * call with the module's real relative path registers a mock that the aliased
 * import *does* bind to.
 *
 * That interception is proven behaviourally by
 * `components/signin/__tests__/signin-contract.spec.tsx`, whose
 * `jest.mock("../../../lib/api/auth", …)` is observably hit by the form's
 * `import { login } from "@/lib/api/auth"`. Every spec in this package that
 * mocks an internal module therefore passes a relative path to `jest.mock` and
 * imports through the alias.
 *
 * Only the alias-import half is asserted here; the throwing half is documented
 * above rather than asserted, so this suite stays independent of jest's
 * internal mock-registry error paths.
 */

it("resolves the @/* alias for import statements", async () => {
  const mod = (await import("@/lib/utils")) as {
    cn: (...parts: unknown[]) => string;
  };

  expect(typeof mod.cn).toBe("function");
  expect(mod.cn("a", false, null, "b")).toBe("a b");
});
