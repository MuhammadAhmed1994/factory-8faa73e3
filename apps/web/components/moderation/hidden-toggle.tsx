"use client";

import { useId } from "react";

import {
  HIDDEN_ONLY_LABEL,
  HIDDEN_TOGGLE_HINT,
  HIDDEN_TOGGLE_LABEL,
  isLeadRole,
} from "@/lib/api/moderation";
import type { MemberRole } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * HiddenToggle — the quiet, lead-only "Hidden only" filter chip that sits
 * beside the LiveIndicator in the board's moderation bar (scr-board-lead,
 * r-mod-bar).
 *
 * Like the hide control it is gated at the **render** level: a member's board
 * renders nothing at all (`null`), never a CSS-hidden or `aria-hidden` switch,
 * because the review variant is lead-only (ADR-5 / Q-4).
 *
 * It is a real `role="switch"` with `aria-checked`, off by default, so the
 * board starts on the shared wall every member sees — the lead's extra powers
 * stay invisible until they are asked for.
 *
 * Visual contract (Warm Editorial Minimal, "Moderation is quiet"):
 * - low-contrast chip: `--card` fill, `--border` hairline, `--secondary` label,
 *   `--muted-foreground` eye-off glyph — none of the celebration accent;
 * - the 28×16px track + 12px thumb follow the reference markup, turning to
 *   `--secondary` when checked;
 * - the caption "Hidden kudos stay visible to leads only." sits under it in
 *   `--muted-foreground`, wrapping to its own row below 768px.
 *
 * The component owns no data: flipping it only calls `onHiddenChange`, and the
 * board swaps its list source to `listHiddenKudos(page)` — where cards render
 * dimmed with a "Hidden" badge and reactions disabled — and back.
 */

/** Component-scoped styles; every colour resolves to a design token. */
const HIDDEN_TOGGLE_CSS = `
.hidden-toggle { display: inline-flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.hidden-toggle__chip {
  display: inline-flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 12px 0 14px;
  border: 1px solid var(--border); border-radius: var(--radius-pill);
  background: var(--card); color: var(--secondary);
  font-family: var(--font-body); font-size: 13px; line-height: 18px; font-weight: 500;
  box-shadow: var(--shadow-card);
  transition: box-shadow 120ms var(--motion-ease-enter), color 120ms var(--motion-ease-enter);
}
.hidden-toggle__chip:hover { box-shadow: var(--shadow-card-hover); color: var(--foreground); }
.hidden-toggle__chip[aria-checked="true"] { color: var(--foreground); border-color: var(--secondary); }
.hidden-toggle__chip:focus-visible {
  outline: 2px solid var(--ring); outline-offset: 2px;
}
.hidden-toggle__icon { display: inline-flex; color: var(--muted-foreground); }
.hidden-toggle__track {
  position: relative; width: 28px; height: 16px; flex: none;
  border-radius: var(--radius-pill); background: var(--border);
  transition: background 200ms var(--motion-ease-enter);
}
.hidden-toggle__chip[aria-checked="true"] .hidden-toggle__track { background: var(--secondary); }
.hidden-toggle__thumb {
  position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
  border-radius: var(--radius-pill); background: var(--card);
  box-shadow: 0 1px 2px rgba(42, 38, 34, 0.28);
  transition: transform 200ms var(--motion-ease-enter);
}
.hidden-toggle__chip[aria-checked="true"] .hidden-toggle__thumb { transform: translateX(12px); }
.hidden-toggle__hint {
  margin: 0; font-family: var(--font-body);
  font-size: 12px; line-height: 16px; color: var(--muted-foreground);
}
@media (max-width: 767px) {
  .hidden-toggle { align-items: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  .hidden-toggle__chip, .hidden-toggle__track, .hidden-toggle__thumb { transition-duration: 200ms; }
}
`;

/** Props accepted by {@link HiddenToggle}. */
export interface HiddenToggleProps {
  /** Session role; anything other than `"LEAD"` renders nothing at all. */
  role?: MemberRole | null;
  /** Whether the hidden-only view is active; defaults to `false` (off). */
  hiddenOnly?: boolean;
  /**
   * Flips the board's list source: `true` switches to the hidden-only view
   * (`GET /api/v1/kudos?hidden=true&page=N`), `false` returns to the live wall.
   */
  onHiddenChange?: (hiddenOnly: boolean) => void;
  /** Disable the switch while the board is loading the other view. */
  disabled?: boolean;
  /** Extra classes for the chip. */
  className?: string;
}

export function HiddenToggle({
  role,
  hiddenOnly = false,
  onHiddenChange,
  disabled = false,
  className,
}: HiddenToggleProps) {
  // Lead gate — `null` for members, never CSS-hidden (lead-only review view).
  if (!isLeadRole(role)) {
    return null;
  }

  return (
    <HiddenToggleChip
      hiddenOnly={hiddenOnly}
      onHiddenChange={onHiddenChange}
      disabled={disabled}
      className={className}
    />
  );
}

/** Inner component, mounted only for leads (keeps hooks out of the gate). */
function HiddenToggleChip({
  hiddenOnly,
  onHiddenChange,
  disabled,
  className,
}: Omit<HiddenToggleProps, "role">) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const hintId = `hidden-toggle-hint-${uid}`;

  return (
    <span className="hidden-toggle">
      <style dangerouslySetInnerHTML={{ __html: HIDDEN_TOGGLE_CSS }} />

      <button
        type="button"
        role="switch"
        aria-checked={hiddenOnly ? "true" : "false"}
        aria-label={HIDDEN_TOGGLE_LABEL}
        aria-describedby={hintId}
        data-testid="hidden-toggle"
        data-hidden-only={hiddenOnly ? "true" : "false"}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        onClick={() => onHiddenChange?.(!hiddenOnly)}
        className={cn("hidden-toggle__chip", className)}
      >
        <span className="hidden-toggle__icon" aria-hidden="true">
          {/* lucide `eye-off`, stroked with `currentColor` (icon_library: lucide) */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-[15px] w-[15px]"
          >
            <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575a1 1 0 0 1 0 .696a10.8 10.8 0 0 1-1.444 2.49m-6.41-.679a3 3 0 0 1-4.242-4.242" />
            <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 4.446-5.143M2 2l20 20" />
          </svg>
        </span>
        {HIDDEN_ONLY_LABEL}
        <span className="hidden-toggle__track" aria-hidden="true">
          <span className="hidden-toggle__thumb" />
        </span>
      </button>

      <p id={hintId} className="hidden-toggle__hint">
        {HIDDEN_TOGGLE_HINT}
      </p>
    </span>
  );
}

export default HiddenToggle;
