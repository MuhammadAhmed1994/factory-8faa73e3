import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

/**
 * Avatar — the recipient/author initials disc (cmp-avatar).
 *
 * - Initials are derived from `name` (first letter of the first and last word,
 *   uppercased; a single word yields one initial).
 * - The warm hue is *deterministic*: a djb2 hash of the trimmed name picks one
 *   of six AA-contrast warm token pairings, so the same person always gets the
 *   same disc across sessions and renders.
 * - Sizes: `sm` = 32px (`h-8 w-8`), `md` = 40px (`h-10 w-10`).
 * - Purely decorative: `aria-hidden="true"` — the name is always rendered
 *   adjacent as text, so the initials never carry meaning on their own.
 *
 * No hardcoded colours: every pairing below is a T-10 palette token.
 */

export type AvatarSize = "sm" | "md";

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-caption",
  md: "h-10 w-10 text-body-s",
};

/**
 * Six deterministic warm pairings (background token + AA-contrast foreground
 * token), ordered from lightest to deepest warmth.
 */
const HUE_CLASSES: readonly string[] = [
  "bg-accent-soft text-primary",
  "bg-accent-soft text-secondary",
  "bg-accent text-foreground",
  "bg-muted text-foreground",
  "bg-primary text-primary-foreground",
  "bg-secondary text-secondary-foreground",
];

/** djb2 string hash, kept unsigned and dependency-free. */
function hashName(name: string): number {
  let hash = 5381;
  for (let index = 0; index < name.length; index += 1) {
    hash = ((hash << 5) + hash + name.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/** Up-to-two-character initials for a display name or email. */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);

  if (words.length === 0) {
    return "•";
  }

  const first = words[0] ?? "";
  if (words.length === 1) {
    return first.slice(0, 1).toUpperCase();
  }

  const last = words[words.length - 1] ?? "";
  return `${first.slice(0, 1)}${last.slice(0, 1)}`.toUpperCase();
}

/** The deterministic warm token pairing for a name (same name → same hue). */
export function getAvatarHue(name: string): string {
  const hue = HUE_CLASSES[hashName(name.trim()) % HUE_CLASSES.length];
  return hue ?? HUE_CLASSES[0]!;
}

/** Props accepted by {@link Avatar}. */
export interface AvatarProps extends ComponentPropsWithoutRef<"span"> {
  /** Person's display name (or email) — the source of the initials and hue. */
  name: string;
  /** `sm` = 32px, `md` = 40px. Defaults to `md`. */
  size?: AvatarSize;
}

export function Avatar({ name, size = "md", className, ...props }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      data-size={size}
      className={cn(
        "inline-flex select-none items-center justify-center rounded-pill font-body font-semibold leading-none",
        SIZE_CLASSES[size],
        getAvatarHue(name),
        className,
      )}
      {...props}
    >
      {getInitials(name)}
    </span>
  );
}

export default Avatar;
