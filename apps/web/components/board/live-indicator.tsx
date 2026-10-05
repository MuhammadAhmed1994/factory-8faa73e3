"use client";

/**
 * LiveIndicator (`cmp-live-indicator`) — the quiet caption row from scr-board.
 *
 * A single amber dot (`--accent`, #E8A33D) plus the caption "Updates every
 * 15s" in `--muted-foreground` (#6E655A). It exists to set the no-refresh
 * expectation, not to demand attention — no badge, no bell, because
 * notifications are explicitly out of scope for this product.
 *
 * States:
 *
 * - `idle`          steady dot — the board is live, the next poll is scheduled.
 * - `syncing`       a poll is in flight right now; the dot dims slightly.
 * - `fresh-arrival` a poll just merged something new. The dot pulses once, in
 *                   the same beat as the arriving card, then returns to steady.
 *
 * The pulse is a one-tick transition rather than a looping keyframe: the parent
 * flips `pulse` for a single tick after each successful merge and this
 * component settles itself back. Because it is a transition (not an infinite
 * animation), the global `prefers-reduced-motion` rule in `app/globals.css`
 * already collapses it to a single 200ms opacity fade — the required fallback,
 * with no duplicated media query here.
 */

import { useEffect, useState } from "react";
import { cn } from "@/components/ui/cn";

/** Caption copy: sets the no-refresh expectation (AC-13). */
export const LIVE_INDICATOR_CAPTION = "Updates every 15s";

/** Fuller phrase announced to assistive tech so the poll beat is not silent. */
export const LIVE_INDICATOR_STATUS = "Live board — updates automatically";

/** How long the dot stays in its pulsed state; the design system's `slow` beat. */
export const LIVE_PULSE_MS = 320;

/** Props for {@link LiveIndicator}. */
export interface LiveIndicatorProps {
  /** Defaults to `idle`. */
  readonly state?: "idle" | "syncing" | "fresh-arrival";
  /**
   * Flip to `true` for one tick after each successful poll merge to fire the
   * dot's single pulse; the component settles itself back afterwards.
   */
  readonly pulse?: boolean;
  /** Extra class names appended after the indicator's own. */
  readonly className?: string;
}

/**
 * The dot-and-caption row shown above the board list.
 *
 * Hidden while the board is on its very first fetch (the scr-board loading
 * state) and appearing with the first kudos.
 */
export function LiveIndicator({
  state = "idle",
  pulse = false,
  className,
}: LiveIndicatorProps) {
  const [isPulsing, setIsPulsing] = useState(false);

  useEffect(() => {
    if (!pulse) return;
    setIsPulsing(true);
    const id = setTimeout(() => setIsPulsing(false), LIVE_PULSE_MS);
    return () => clearTimeout(id);
  }, [pulse]);

  return (
    <p
      data-state={state}
      data-pulse={isPulsing ? "true" : "false"}
      className={cn(
        "flex items-center gap-2 font-sans text-caption text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-state={state}
        data-pulse={isPulsing ? "true" : "false"}
        className={cn(
          "h-2 w-2 flex-none rounded-pill bg-accent",
          "transition-[opacity,transform] duration-slow ease-enter",
          "data-[state=syncing]:opacity-60",
          isPulsing ? "scale-150 opacity-30" : "scale-100 opacity-100",
        )}
      />
      <span>{LIVE_INDICATOR_CAPTION}</span>
      <span className="sr-only" role="status">
        {LIVE_INDICATOR_STATUS}
      </span>
    </p>
  );
}

export default LiveIndicator;
