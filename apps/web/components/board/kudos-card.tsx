"use client";

import type { ReactNode } from "react";

import Avatar from "@/components/ui/avatar";
import ReactionPicker from "@/components/reactions/reaction-picker";
import HideControl from "@/components/moderation/hide-control";
import { HIDDEN_BADGE_LABEL, isLeadRole } from "@/lib/api/moderation";
import type { MemberRole } from "@/lib/api-client";
import type { Kudos } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * KudosCard — one thank-you note on the wall (cmp-card).
 *
 * Content is the interface, so the card is exactly the four things a kudos is:
 *
 * ```
 * ┌──────────────────────────────────────────────────┐
 * │ (MN)  Priya N.                        2 minutes ago│ ← recipient (avatar + h2)
 * │        maya@team.co · …                            │   author + relative time
 * │ Shipped the migration on a Friday and nothing     │ ← message, body_m
 * │ caught fire. Legend.                               │
 * │ [🎉 3] [❤️ 1]  [＋ React]                          │ ← reaction row + picker
 * └──────────────────────────────────────────────────┘
 * ```
 *
 * States (surfaced as `data-state`):
 * - `default`     the card as the API returned it.
 * - `arriving`    the amber arrival wash — set for the ~1.2s after a kudos
 *                 lands in the top slot (own post **or** a 15s poll arrival).
 *                 Driven by the `.kudos-card[data-arriving]` animation in
 *                 `app/globals.css`, so no colour lives here.
 * - `mine-authored` the signed-in member wrote it — a quiet "You" author label.
 * - `hiding`      a lead's hide just succeeded; the board fades it out.
 * - `hidden`      the card came from the lead-only review view — dimmed with a
 *                 "Hidden" badge and its reactions disabled.
 *
 * **Lead actions are server-rendered, never CSS-hidden.** The card receives the
 * session role from the server component and renders the hide control only for
 * `role === "LEAD"`; a member's card simply has no such subtree, so it is absent
 * from the DOM, the tab order and every accessibility tree.
 *
 * Accessibility: the recipient name is the card's `h2` — the a11y spec's heading
 * order is h1 "Team Kudos" → one h2 per card recipient — the author + relative
 * time is a `caption` line, and the reaction row is the shared picker (chips +
 * popover) which owns its own labels and keyboard behaviour.
 */

/** The board's "how old is this?" copy. */
export const JUST_NOW_LABEL = "just now";

/** Milliseconds before "just now" becomes a counted unit. */
const JUST_NOW_MS = 45_000;

/** One rung of the relative ladder, in ms and words. */
const RELATIVE_STEPS: ReadonlyArray<{
  readonly limit: number;
  readonly divisor: number;
  readonly singular: string;
  readonly plural: string;
}> = [
  { limit: 60_000, divisor: 1_000, singular: "second", plural: "seconds" },
  { limit: 3_600_000, divisor: 60_000, singular: "minute", plural: "minutes" },
  { limit: 86_400_000, divisor: 3_600_000, singular: "hour", plural: "hours" },
  {
    limit: 2_592_000_000,
    divisor: 86_400_000,
    singular: "day",
    plural: "days",
  },
  {
    limit: 31_536_000_000,
    divisor: 2_592_000_000,
    singular: "month",
    plural: "months",
  },
];

/**
 * Renders `createdAt` as a relative phrase — "just now", "2 minutes ago",
 * "3 days ago" — the microcopy's `2 minutes ago` example included.
 *
 * Falls back to a fixed phrase when the timestamp cannot be parsed, so a
 * malformed payload never renders "NaN undefineds ago".
 */
export function formatRelativeTime(
  createdAt: string,
  now: Date = new Date(),
): string {
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) {
    return "some time ago";
  }

  const elapsed = now.getTime() - at;
  if (elapsed < JUST_NOW_MS && elapsed >= -JUST_NOW_MS) {
    return JUST_NOW_LABEL;
  }

  const future = elapsed < 0;
  const distance = Math.abs(elapsed);

  for (const step of RELATIVE_STEPS) {
    if (distance < step.limit) {
      const value = Math.max(Math.floor(distance / step.divisor), 1);
      const unit = value === 1 ? step.singular : step.plural;
      return future ? `in ${value} ${unit}` : `${value} ${unit} ago`;
    }
  }

  const years = Math.max(Math.floor(distance / 31_536_000_000), 1);
  const unit = years === 1 ? "year" : "years";
  return future ? `in ${years} ${unit}` : `${years} ${unit} ago`;
}

/** Total reactions on a kudos — the wall's quiet "how loud was this?" number. */
export function totalReactions(kudos: Kudos): number {
  return kudos.reactions.reduce((sum, reaction) => sum + reaction.count, 0);
}

/** The author line as the card renders it: "maya@team.co · 2 minutes ago". */
export function authorLine(kudos: Kudos, now?: Date): string {
  return `${kudos.author.email} · ${formatRelativeTime(kudos.createdAt, now)}`;
}

/** Props accepted by {@link KudosCard}. */
export interface KudosCardProps {
  /** The kudos to render, in the uniform ADR-7 shape. */
  kudos: Kudos;
  /**
   * Session role, resolved server-side and passed down as a plain prop. Only a
   * `LEAD` renders the hide control — never CSS-hidden.
   */
  role?: MemberRole | null;
  /** Signed-in member's email, for the "You" author marker. */
  viewerEmail?: string | null;
  /** `true` while the card plays the amber arrival wash (AC-7 / AC-13). */
  arriving?: boolean;
  /** `true` while the board fades the card out after a successful hide. */
  hiding?: boolean;
  /** `true` when the card came from the lead-only hidden review view. */
  hidden?: boolean;
  /** Receives the kudos the reaction API returned, so the board can sync. */
  onKudosChange?: (kudos: Kudos) => void;
  /** A lead hid this kudos; the board removes it after the exit fade. */
  onHidden?: (kudosId: string) => void;
  /** Any 401 — the board owns the redirect to `/signin`. */
  onUnauthenticated?: () => void;
  /** Extra classes for the card. */
  className?: string;
}

/**
 * The lead-actions slot: the hide control, rendered **only** for leads.
 *
 * Kept as a named export so the composition is explicit — the board passes the
 * session `role` straight from the server component and this decides what
 * exists in the DOM at all.
 */
export function KudosLeadActions({
  kudosId,
  role,
  onHidden,
  onUnauthenticated,
}: {
  kudosId: string;
  role?: MemberRole | null;
  onHidden?: (kudosId: string) => void;
  onUnauthenticated?: () => void;
}): ReactNode {
  if (!isLeadRole(role)) {
    return null;
  }
  return (
    <HideControl
      kudosId={kudosId}
      role={role}
      onHidden={onHidden}
      onUnauthenticated={onUnauthenticated}
    />
  );
}

export function KudosCard({
  kudos,
  role,
  viewerEmail,
  arriving = false,
  hiding = false,
  hidden = false,
  onKudosChange,
  onHidden,
  onUnauthenticated,
  className,
}: KudosCardProps) {
  const mine = viewerEmail != null && kudos.author.email === viewerEmail;
  const state = hiding
    ? "hiding"
    : hidden
      ? "hidden"
      : arriving
        ? "arriving"
        : mine
          ? "mine-authored"
          : "default";

  return (
    <article
      className={cn(
        "kudos-card relative rounded-card border border-border bg-card px-4 py-5 shadow-card sm:px-[22px]",
        "transition duration-base ease-enter",
        hiding && "opacity-0",
        hidden && "opacity-80",
        className,
      )}
      data-testid="kudos-card"
      data-kudos-id={kudos.id}
      data-state={state}
      data-arriving={arriving ? "true" : undefined}
      data-hiding={hiding ? "true" : undefined}
      data-hidden={hidden ? "true" : undefined}
      aria-label={`Kudos for ${kudos.recipient}`}
    >
      <header className="flex items-start gap-3">
        <Avatar name={kudos.recipient} size="md" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          {/* h2 per card recipient — the a11y spec's heading order. */}
          <h2 className="type-heading-m font-heading truncate font-bold">
            {kudos.recipient}
          </h2>
          <p className="type-caption mt-0.5 truncate text-muted-foreground">
            {mine ? (
              <>
                <span className="font-medium text-foreground">You</span>
                {" · "}
              </>
            ) : null}
            <span data-testid="kudos-card-author">{kudos.author.email}</span>
            {" · "}
            <time dateTime={kudos.createdAt} data-testid="kudos-card-time">
              {formatRelativeTime(kudos.createdAt)}
            </time>
          </p>
        </div>

        {hidden ? (
          <span
            className="type-overline inline-flex items-center rounded-pill border border-border bg-muted px-2 py-0.5 text-muted-foreground"
            data-testid="hidden-badge"
          >
            {HIDDEN_BADGE_LABEL}
          </span>
        ) : null}

        <KudosLeadActions
          kudosId={kudos.id}
          role={hidden ? null : role}
          onHidden={onHidden}
          onUnauthenticated={onUnauthenticated}
        />
      </header>

      <p
        className="type-body-m mt-4 whitespace-pre-line break-words text-foreground"
        data-testid="kudos-card-message"
      >
        {kudos.message}
      </p>

      <div className="mt-4">
        <ReactionPicker
          kudos={kudos}
          onKudosChange={onKudosChange}
          onUnauthenticated={onUnauthenticated}
          className={hidden ? "pointer-events-none opacity-60" : undefined}
        />
      </div>
    </article>
  );
}

export default KudosCard;
