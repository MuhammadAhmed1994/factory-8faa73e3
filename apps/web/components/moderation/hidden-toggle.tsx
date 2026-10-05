"use client";

/**
 * HiddenToggle — the quiet, lead-only `Hidden only` switch (scr-board-lead).
 *
 * It sits beside the LiveIndicator as a low-contrast chip, off by default, and
 * is the *only* persistent way into the soft-hidden review view (ADR-5). Leads
 * and members share one board and one URL until it is flipped.
 *
 * Rendered server-side too: when the session role is not `LEAD` the component
 * returns `null` — never a CSS-hidden control — so a member's board carries no
 * moderation affordance at all.
 *
 * The switch is controlled-with-a-default: the board owns the real state
 * because it owns the list source, and this component reports flips through
 * `onHiddenChange`. Pass `hidden` to keep it in sync with that state.
 *
 * Alongside the switch this module exports the two pieces the hidden-only view
 * needs from the moderation surface: {@link HiddenKudosCard} (dimmed card,
 * `Hidden` badge, reactions disabled, no hide control — it is already hidden)
 * and {@link HiddenOnlyList} with the `Nothing hidden…` empty variant.
 */

import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn, FOCUS_RING } from "@/components/ui/cn";
import type { Kudos, MemberRole } from "@/lib/api-client";
import type { HiddenKudos } from "@/lib/api/moderation";

/** Visible chip label. */
export const HIDDEN_ONLY_LABEL = "Hidden only";

/** Accessible name — the visible label alone does not say what it does. */
export const HIDDEN_ONLY_SWITCH_LABEL =
  "Hidden only — show kudos hidden from the board";

/** Quiet helper under the chip (scr-board-lead microcopy). */
export const HIDDEN_ONLY_HINT = "Hidden kudos stay visible to leads only.";

/** Empty variant of the hidden-only view. */
export const HIDDEN_ONLY_EMPTY_MESSAGE =
  "Nothing hidden. The board is a nice place today.";

/** The `Hidden` badge's label, also used as the card's state text. */
export const HIDDEN_BADGE_LABEL = "Hidden";

/** Lucide `eye-off` — the same glyph the hide control uses. Decorative. */
function EyeOffIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575a1 1 0 0 1 0 .696a10.8 10.8 0 0 1-1.444 2.49m-6.41-.679a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 4.446-5.143M2 2l20 20" />
    </svg>
  );
}

/** Props for {@link HiddenToggle}. */
export interface HiddenToggleProps {
  /** Session role; anything but `LEAD` renders nothing at all. */
  readonly role: MemberRole;
  /**
   * Current on/off state. Omit to let the chip manage itself (off by default);
   * pass it when the board keeps the list source in its own state.
   */
  readonly hidden?: boolean;
  /** Fired with the next state each time the switch is flipped. */
  readonly onHiddenChange: (hidden: boolean) => void;
  /** Extra class names appended after the chip's own. */
  readonly className?: string;
}

/**
 * The `Hidden only` switch. Off by default, `role="switch"` with `aria-checked`,
 * and quiet: neutral card surface, muted icon, no accent.
 */
export function HiddenToggle({
  role,
  hidden,
  onHiddenChange,
  className,
}: HiddenToggleProps) {
  const [internalHidden, setInternalHidden] = useState(false);
  // Off by default; the board's `hidden` prop wins when it supplies one.
  const isOn = hidden ?? internalHidden;

  const flip = useCallback(() => {
    const next = !isOn;
    setInternalHidden(next);
    onHiddenChange(next);
  }, [isOn, onHiddenChange]);

  if (role !== "LEAD") return null;

  return (
    <span className={cn("inline-flex flex-col items-start gap-1.5", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={HIDDEN_ONLY_SWITCH_LABEL}
        title={HIDDEN_ONLY_LABEL}
        data-state={isOn ? "on" : "off"}
        onClick={flip}
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-pill border border-border bg-card px-3.5",
          "text-body-s font-medium text-secondary shadow-card",
          "transition duration-base ease-enter hover:bg-muted",
          FOCUS_RING,
        )}
      >
        <EyeOffIcon className="h-4 w-4 text-muted-foreground" />
        {HIDDEN_ONLY_LABEL}

        {/* The visual track. Decorative: `aria-checked` carries the state. */}
        <span
          aria-hidden="true"
          className={cn(
            "relative ml-1 h-4 w-7 flex-none rounded-pill transition-colors duration-base ease-enter",
            isOn ? "bg-muted-foreground" : "bg-border",
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 h-3 w-3 rounded-pill bg-card shadow-card",
              "transition-transform duration-base ease-enter",
              isOn ? "translate-x-3" : "translate-x-0",
            )}
          />
        </span>
      </button>

      <p className="text-caption text-muted-foreground">{HIDDEN_ONLY_HINT}</p>
    </span>
  );
}

/** Props for {@link HiddenKudosCard}. */
export interface HiddenKudosCardProps {
  /** A kudos from `listHiddenKudos` — the standard shape plus audit fields. */
  readonly kudos: HiddenKudos;
  /** Extra class names appended after the card's own. */
  readonly className?: string;
}

/**
 * Renders a hidden kudos: dimmed, tagged `Hidden`, with its reaction counts
 * shown inert — reacting to something already off the board is disabled, and
 * there is no hide control because it is already hidden.
 *
 * Heading structure matches a board card: the recipient stays an `h2` so the
 * hidden view keeps the same logical outline.
 */
export function HiddenKudosCard({ kudos, className }: HiddenKudosCardProps) {
  return (
    <article
      data-hidden="true"
      data-kudos-id={kudos.id}
      className={cn(
        "kudos-card flex flex-col gap-3.5 rounded-card border border-border bg-card p-5 shadow-card",
        "opacity-70",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <h2 className="font-heading text-heading-m text-foreground">
          {kudos.recipient}
        </h2>
        <Badge variant="hidden">{HIDDEN_BADGE_LABEL}</Badge>
      </div>

      <p className="text-body-m text-foreground">{kudos.message}</p>

      <p className="text-caption text-muted-foreground">
        {kudos.author.email} · hidden {formatHiddenDate(kudos.hiddenAt)}
      </p>

      <ul className="flex flex-wrap items-center gap-2">
        {kudos.reactions.length === 0 ? (
          <li className="text-caption text-muted-foreground">No reactions</li>
        ) : (
          kudos.reactions.map((reaction) => (
            <li key={reaction.emoji}>
              {/* Reactions are disabled on a hidden kudos: an inert chip, not a control. */}
              <span
                aria-disabled="true"
                title="Reactions are disabled on hidden kudos"
                className={cn(
                  "inline-flex items-center gap-1 rounded-pill border border-border bg-muted",
                  "px-2 py-0.5 text-caption text-muted-foreground",
                )}
              >
                <span aria-hidden="true">{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </span>
            </li>
          ))
        )}
      </ul>
    </article>
  );
}

/** Props for {@link HiddenOnlyList}. */
export interface HiddenOnlyListProps {
  /**
   * The current page of hidden kudos, newest first. Typed as the standard
   * kudos too, because a board may already hold plain rows when it flips to
   * this view; missing audit fields are normalised per item.
   */
  readonly items: readonly (HiddenKudos | Kudos)[];
  /** Extra class names appended after the list's own. */
  readonly className?: string;
}

/**
 * Normalises one row into the hidden shape, falling back to `createdAt` for
 * `hiddenAt` — the row is on this list precisely because it *was* hidden, so a
 * missing audit field is a transport gap, not a different kind of row.
 */
function toHiddenKudos(item: HiddenKudos | Kudos): HiddenKudos {
  const maybe = item as Partial<HiddenKudos>;
  return {
    ...item,
    hiddenAt:
      typeof maybe.hiddenAt === "string" && maybe.hiddenAt.length > 0
        ? maybe.hiddenAt
        : item.createdAt,
    hiddenBy: typeof maybe.hiddenBy === "string" ? maybe.hiddenBy : null,
  };
}

/** The empty variant: typographic, celebratory of nothing needing hiding. */
export function HiddenOnlyEmptyState({
  className,
}: {
  readonly className?: string;
}) {
  return (
    <div
      data-empty="hidden"
      className={cn(
        "rounded-card border border-border bg-card p-8 text-center shadow-card",
        className,
      )}
    >
      <p aria-hidden="true" className="font-heading text-display">
        🎉
      </p>
      <p className="mt-3 font-heading text-heading-s text-foreground">
        {HIDDEN_ONLY_EMPTY_MESSAGE}
      </p>
      <p className="mt-1 text-caption text-muted-foreground">
        {HIDDEN_ONLY_HINT}
      </p>
    </div>
  );
}

/**
 * The board's hidden-only view: the dimmed cards, or the `Nothing hidden` empty
 * variant when the team kept the board a nice place.
 */
export function HiddenOnlyList({ items, className }: HiddenOnlyListProps) {
  if (items.length === 0) return <HiddenOnlyEmptyState className={className} />;

  return (
    <ul aria-label="Hidden kudos" className={cn("flex flex-col gap-4", className)}>
      {items.map((item) => (
        <li key={item.id}>
          <HiddenKudosCard kudos={toHiddenKudos(item)} />
        </li>
      ))}
    </ul>
  );
}

/** Stable `YYYY-MM-DD` rendering — no locale, so SSR and hydration agree. */
function formatHiddenDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "earlier";
  return new Date(parsed).toISOString().slice(0, 10);
}

export default HiddenToggle;
