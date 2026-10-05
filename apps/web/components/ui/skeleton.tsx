/**
 * Skeleton (`cmp-skeleton`) — a muted placeholder block.
 *
 * Renders the `--muted` token (#F1EBE1 via `bg-muted`), rounded and inert. The
 * board renders it 8-up on first load while page 1 is server-fetched, so the
 * placeholder never flashes on every visit (the board route is a Server
 * Component that renders real cards on first paint).
 *
 * Static by default: there is no shimmer animation to remove under
 * `prefers-reduced-motion` — the block simply sits there. A pulse is opt-in via
 * `animated` and is collapsed by the global reduced-motion rule in
 * `app/globals.css`, which caps every animation at 200ms and one iteration.
 */

import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn";

/** Props for {@link Skeleton}. */
export interface SkeletonProps {
  /** Extra class names appended after the primitive's own — width/height live here. */
  readonly className?: string;
  /**
   * Opt into the subtle pulse. Off by default so the skeleton is static under
   * `prefers-reduced-motion` without any extra handling.
   */
  readonly animated?: boolean;
  /** Inline style overrides, e.g. an explicit height. */
  readonly style?: CSSProperties;
  /** Nothing is rendered inside a skeleton; accepted for API symmetry. */
  readonly children?: ReactNode;
}

/**
 * The shared skeleton block.
 *
 * A Server Component: purely presentational.
 */
export function Skeleton({
  className,
  animated = false,
  style,
  children = null,
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      data-animated={animated ? "true" : undefined}
      className={cn(
        "rounded-control bg-muted",
        animated ? "animate-pulse" : "",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

export default Skeleton;
