/**
 * Class-name joiner for the shared UI primitives (`components/ui/*`).
 *
 * The usual `clsx` + `tailwind-merge` pair is not installed in this workspace,
 * so this covers the one job the primitives have: concatenate truthy class names
 * in order, letting a caller's `className` land after — and therefore win over —
 * the primitive's own defaults.
 *
 * Everything the primitives render is styled through the design tokens declared
 * in `app/globals.css` and mapped in `tailwind.config.ts`; no hex values live in
 * component code.
 */

/** A class name that may be absent. */
export type ClassValue = string | false | null | undefined;

/**
 * The always-visible focus ring shared by every interactive primitive
 * (`cmp-button`, `cmp-input`, …): 2px amber at 45% opacity with a 2px offset.
 *
 * `app/globals.css` already applies this to `:focus-visible` globally; the
 * primitives repeat it so the ring is guaranteed on the control itself and is
 * never removed without a replacement (a11y requirement).
 */
export const FOCUS_RING = [
  "focus-visible:outline",
  "focus-visible:outline-2",
  "focus-visible:outline-offset-2",
  "focus-visible:outline-[color:var(--focus-ring)]",
].join(" ");

/** Joins truthy class names with a single space. */
export function cn(...classes: readonly ClassValue[]): string {
  const names: string[] = [];
  for (const value of classes) {
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (name.length > 0) names.push(name);
  }
  return names.join(" ");
}

export default cn;
