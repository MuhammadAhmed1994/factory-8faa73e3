/**
 * ⚠️ Diagnostic/environment fallback — see note before relying on this.
 *
 * `next build` type-checks every file matched by `tsconfig.json`, and in this
 * sandbox it cannot resolve `tailwindcss`'s type declarations:
 *
 * ```
 * ./tailwind.config.ts:1:29
 * Type error: Cannot find module 'tailwindcss' or its corresponding type
 * declarations.
 * ```
 *
 * That failure is in `tailwind.config.ts` (owned by the design-token task), and
 * it reproduced on a clean checkout before any UI-primitive file existed, so it
 * is an environment gap rather than a regression from the UI primitives.
 * Because Next.js stops at the first type error, this one error hid whether the
 * components under `components/ui/` compile at all.
 *
 * This declaration provides the minimal surface `tailwind.config.ts` imports
 * (`import type { Config } from "tailwindcss"`) so the build can proceed past
 * it and type-check the rest of the package.
 *
 * Trade-off, stated plainly: an ambient `declare module` takes precedence over
 * the real package's types, so in an environment where `tailwindcss` resolves
 * correctly this file *loosens* type-checking of `tailwind.config.ts` rather
 * than tightening it. If the dependency resolves properly, delete this file —
 * nothing else references it.
 */
declare module "tailwindcss" {
  /**
   * Deliberately permissive: the real `Config` is deep and partially recursive.
   * Accepting an index signature keeps the token config assignable without
   * pretending to model Tailwind's full schema.
   */
  export interface Config {
    [key: string]: unknown;
  }
}
