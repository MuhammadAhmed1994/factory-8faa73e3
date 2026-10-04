/**
 * Tiny class-name joiner used by every UI primitive.
 *
 * Deliberately dependency-free (no `clsx` / `tailwind-merge`): the workspace
 * lockfile provisions no such package, and the primitives only ever need to
 * concatenate conditional token classes — the last caller-supplied class wins
 * by virtue of Tailwind's source order, which is enough for this design system.
 */

/** Anything accepted as a conditional class-name contribution. */
export type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | ClassValue[];

/**
 * Joins truthy class names, flattening nested arrays.
 *
 * ```ts
 * cn("a", false && "b", ["c", undefined], "d"); // "a c d"
 * ```
 */
export function cn(...classes: ClassValue[]): string {
  const out: string[] = [];

  const walk = (value: ClassValue): void => {
    if (!value) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const text = typeof value === "number" ? String(value) : value;
    if (text.trim().length > 0) {
      out.push(text);
    }
  };

  for (const value of classes) {
    walk(value);
  }

  return out.join(" ");
}
