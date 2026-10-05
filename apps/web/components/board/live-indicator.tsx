"use client";

import { cn } from "@/lib/utils";

/**
 * LiveIndicator — the quiet caption row above the board wall (cmp-live-indicator).
 *
 * Sets the no-refresh expectation for the 15s poll (AC-13 / ADR-3): an amber
 * (`--accent`, #E8A33D) dot plus the caption "Updates every 15s" in
 * `--muted-foreground` (#6E655A). Nothing else moves on the screen.
 *
 * States:
 * - `idle`          steady dot, board is showing the last merged data.
 * - `syncing`       a page-1 poll is in flight — the dot breathes softly while
 *                   the wall itself stays fully interactive.
 * - `fresh-arrival` the last merge brought in kudos from another session — the
 *                   dot keeps a soft amber halo until the next state change.
 *
 * The dot pulses **once** on every successful poll merge: `pulseAt` (the
 * `lastMergedAt` epoch ms from `useLiveBoard`) is used as the dot's React key,
 * so each new merge remounts it and replays the single 320ms pulse. Under
 * `prefers-reduced-motion` both the pulse and the breathe collapse to a single
 * 200ms opacity fade, per the design system's reduced-motion rule (polling
 * itself is not motion and continues).
 */

/** The three visual states of the indicator. */
export type LiveIndicatorState = "idle" | "syncing" | "fresh-arrival";

/** Default caption (copy pinned by scr-board). */
export const LIVE_INDICATOR_CAPTION = "Updates every 15s";

/**
 * Component-scoped keyframes.
 *
 * Declared here rather than in `app/globals.css` (owned by the scaffold task)
 * and expressed entirely through the design tokens' CSS variables, so no hex
 * value is hardcoded in the component.
 */
const LIVE_INDICATOR_CSS = `
.live-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.live-indicator__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--accent);
}
.live-indicator__dot[data-state="syncing"] {
  animation: live-indicator-breathe 1200ms ease-in-out infinite;
}
.live-indicator__dot[data-state="fresh-arrival"] {
  box-shadow: 0 0 0 3px var(--accent-soft);
}
/* Declared last so a merge pulse always wins over the syncing breathe. */
.live-indicator__dot[data-pulse="true"] {
  animation: live-indicator-pulse 320ms var(--motion-ease-enter) 1 both;
}
@keyframes live-indicator-pulse {
  0% { transform: scale(1); opacity: 1; }
  40% { transform: scale(1.9); opacity: 0.95; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes live-indicator-breathe {
  0% { opacity: 0.45; }
  50% { opacity: 1; }
  100% { opacity: 0.45; }
}
@keyframes live-indicator-fade {
  0% { opacity: 0; }
  100% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .live-indicator__dot[data-pulse="true"],
  .live-indicator__dot[data-state="syncing"] {
    animation: live-indicator-fade 200ms linear 1 both;
  }
}
`;

/** Props accepted by {@link LiveIndicator}. */
export interface LiveIndicatorProps {
  /** Current visual state; defaults to `idle`. */
  state?: LiveIndicatorState;
  /**
   * Epoch milliseconds of the most recent successful poll merge
   * (`lastMergedAt?.getTime()`). Every new value replays the dot's single
   * pulse; `null` keeps the dot quiet.
   */
  pulseAt?: number | null;
  /** Caption text; defaults to "Updates every 15s". */
  label?: string;
  /** Extra classes for the caption row. */
  className?: string;
}

export function LiveIndicator({
  state = "idle",
  pulseAt = null,
  label = LIVE_INDICATOR_CAPTION,
  className,
}: LiveIndicatorProps) {
  // Keying the dot on `pulseAt` remounts it on every merge, which is what
  // replays the one-shot CSS pulse.
  const dotKey = typeof pulseAt === "number" ? `live-dot-${pulseAt}` : "live-dot-idle";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LIVE_INDICATOR_CSS }} />
      <p
        className={cn(
          "live-indicator type-caption text-muted-foreground",
          className,
        )}
        data-state={state}
        data-testid="live-indicator"
      >
        <span
          key={dotKey}
          className="live-indicator__dot"
          data-state={state}
          data-pulse={typeof pulseAt === "number" ? "true" : "false"}
          aria-hidden="true"
        />
        <span className="live-indicator__label">{label}</span>
      </p>
    </>
  );
}

export default LiveIndicator;
