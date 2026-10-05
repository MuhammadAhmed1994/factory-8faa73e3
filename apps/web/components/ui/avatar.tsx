/**
 * Avatar (`cmp-avatar`) — initials on a deterministic warm hue.
 *
 * Purely decorative: it renders `aria-hidden="true"` and no accessible name,
 * because the person's name is always rendered adjacent to it (the kudos card
 * recipient line, the header email). The hue is derived deterministically from
 * the name, so the same colleague always gets the same colour across sessions.
 *
 * Two sizes: `sm` (32px) for dense rows and `md` (40px) for card recipients.
 */

import type { CSSProperties } from "react";
import { cn } from "./cn";

/** Sizes of {@link Avatar}. */
export type AvatarSize = "sm" | "md";

/** Props for {@link Avatar}. */
export interface AvatarProps {
  /** The person's name; its initials and hash drive the render. */
  readonly name: string;
  /** Defaults to `md`. */
  readonly size?: AvatarSize;
  /** Extra class names appended after the primitive's own. */
  readonly className?: string;
}

/** Size classes — 32px and 40px circles with matching type sizes. */
const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "h-8 w-8 text-caption",
  md: "h-10 w-10 text-body-s",
};

/**
 * The warm hue band, in degrees.
 *
 * The palette is `warm-editorial-minimal`, so the hue is folded into the warm
 * family (0° red through 60° yellow) rather than spread across the full colour
 * wheel — the avatar reads as part of the paper-like canvas instead of a cold
 * accent competing with the single amber.
 */
const WARM_HUE_SPAN = 60;

/**
 * FNV-1a over the lower-cased, trimmed name.
 *
 * Deliberately simple and stable: a change here would re-colour every avatar at
 * once, so it stays a tiny, explicit, dependency-free hash.
 */
export function hashName(name: string): number {
  const normalized = name.trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The warm hue for `name`, in degrees — the same name always maps to the same
 * hue, so a colleague's avatar is stable across sessions and machines.
 */
export function avatarHue(name: string): number {
  return hashName(name) % WARM_HUE_SPAN;
}

/**
 * The initials for `name`: first letter of the first word plus the first letter
 * of the last word (`Ada Lovelace` → `AL`), or just the first letter of a
 * one-word name.
 *
 * Returns `?` for a blank name so the avatar never renders empty.
 */
export function avatarInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) return "?";

  const first = words[0]?.charAt(0) ?? "";
  const last =
    words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? "") : "";
  const initials = `${first}${last}`.toUpperCase();

  return initials.length > 0 ? initials : "?";
}

/**
 * The shared avatar.
 *
 * A Server Component: pure decoration with no state or handlers.
 *
 * The tint is the one place a colour must be computed at render time — the hue
 * comes from the name, so it cannot be a static class. To keep colour usage in
 * the class layer, the class is a static literal Tailwind emits
 * (`bg-[hsl(var(--avatar-hue)_42%_87%)]`) and only the hue is injected as a CSS
 * custom property. No hex value appears anywhere.
 */
export function Avatar({ name, size = "md", className }: AvatarProps) {
  const initials = avatarInitials(name);
  const hue = avatarHue(name);

  const tintStyle = {
    "--avatar-hue": `${hue}deg`,
  } as CSSProperties;

  return (
    <span
      aria-hidden="true"
      data-size={size}
      data-hue={hue}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-pill border border-border font-heading font-bold uppercase text-foreground",
        "bg-[hsl(var(--avatar-hue)_42%_87%)]",
        SIZE_CLASSES[size],
        className,
      )}
      style={tintStyle}
    >
      {initials}
    </span>
  );
}

export default Avatar;
