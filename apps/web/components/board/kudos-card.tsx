"use client";

/**
 * KudosCard (`cmp-card`) — one thank-you note on the wall.
 *
 * Content is the interface, so the recipient and the message are the largest
 * text on the card and the chrome recedes: a white card on the warm canvas with
 * the soft espresso shadow, and nothing else decorated.
 *
 * Layout, matching `scr-board`:
 *
 * ```text
 * [avatar] recipient (h2)  ·  Hide  ·  just now
 * message (body_m)
 * [🎉 3] [❤️ 1] [React ▾]
 * ```
 *
 * Designed states, surfaced as attributes on the `<article>`:
 *
 * - `data-arriving`  the amber wash — `app/globals.css` keys a ~1.2s fade of
 *                    `--accent-soft`/`--accent` off the card. Driven by JS so
 *                    the effect stays scoped to one card (theming rule).
 * - `data-mine`      the signed-in member authored this kudos.
 * - `data-hidden`    the lead-only review variant renders a dimmed card.
 *
 * The lead-actions slot is **server-decided**: the board only passes a non-null
 * `leadActions` when the session role is `LEAD`, so a member's DOM carries no
 * moderation affordance at all — never a CSS-hidden control (AC-19).
 *
 * Heading structure: the recipient is an `h2` under the page's `h1` `Team
 * Kudos`, keeping a logical outline.
 */

import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/components/ui/cn";
import { ReactionPicker } from "@/components/reactions/reaction-picker";
import type { Kudos, ReactionSummary } from "@/lib/api/types";

/** How the author line is prefixed; the email follows. */
const AUTHOR_PREFIX = "by";

/** Prefix of the relative-time caption, rendered `· {relative}`. */
const TIME_PREFIX = "·";

/** Announced instead of an unparseable timestamp. */
const UNKNOWN_TIME = "sometime";

/** Lower bound for "just now", in seconds. */
const JUST_NOW_SECONDS = 45;

/** Seconds in a minute/hour/day/week, for the relative buckets. */
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const WEEK_SECONDS = 7 * DAY_SECONDS;

/**
 * Renders `createdAt` as a relative phrase.
 *
 * SSR and the first client render must agree or React hydrates with a
 * mismatch, so the buckets are coarse (45s, a minute, hours, days, weeks) and
 * never encode the server's timezone. A poll merge re-renders the card, which
 * is how the timestamp refreshes.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return UNKNOWN_TIME;

  const seconds = Math.max(0, Math.floor((now - parsed) / 1000));
  if (seconds < JUST_NOW_SECONDS) return "just now";

  const minutes = Math.floor(seconds / MINUTE_SECONDS);
  if (minutes < MINUTE_SECONDS) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  const hours = Math.floor(seconds / HOUR_SECONDS);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(seconds / DAY_SECONDS);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  const weeks = Math.floor(seconds / WEEK_SECONDS);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

/** The announcement the board's live region reads for one arrival (AC-13). */
export const arrivalAnnouncement = (recipient: string): string =>
  `New kudos for ${recipient}`;

/** Props for {@link KudosCard}. */
export interface KudosCardProps {
  /** The kudos rendered, in the uniform ADR-7 shape. */
  readonly kudos: Kudos;
  /** True when the viewer authored this kudos (adds the `data-mine` state). */
  readonly authoredByViewer?: boolean;
  /**
   * Lead-only actions, rendered in the card head. Pass `undefined` for a
   * member — the slot is then not rendered at all.
   */
  readonly leadActions?: ReactNode;
  /** True for one beat after this card arrives (own post or poll merge). */
  readonly arriving?: boolean;
  /** Reactions to render; defaults to the kudos' own. */
  readonly reactions?: readonly ReactionSummary[];
  /** Called after a reaction is saved, with the reconciled kudos. */
  readonly onReactionSaved?: (kudos: Kudos) => void;
  /** Called when the reaction API answers 401 — the board routes to `/signin`. */
  readonly onUnauthorized?: () => void;
  /** Extra class names appended after the card's own. */
  readonly className?: string;
}

/**
 * One kudos card.
 *
 * A Client Component because it hosts the reaction picker island; the recipient,
 * message and author line are all rendered from props on the server too.
 */
export function KudosCard({
  kudos,
  authoredByViewer = false,
  leadActions,
  arriving = false,
  reactions = kudos.reactions,
  onReactionSaved,
  onUnauthorized,
  className,
}: KudosCardProps) {
  const recipient = kudos.recipient;
  const relative = formatRelativeTime(kudos.createdAt);

  return (
    <article
      data-kudos-id={kudos.id}
      data-arriving={arriving ? "true" : undefined}
      data-mine={authoredByViewer ? "true" : undefined}
      data-testid={`kudos-card-${kudos.id}`}
      className={cn(
        "kudos-card rounded-card border border-border bg-card p-5 shadow-card",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar name={recipient} size="md" />

        <div className="min-w-0 flex-1">
          <h2
            data-testid="kudos-recipient"
            className="truncate font-heading text-heading-m text-foreground"
          >
            {recipient}
          </h2>
          <p
            data-testid="kudos-author"
            className="mt-0.5 truncate text-caption text-muted-foreground"
          >
            <span className="sr-only">{AUTHOR_PREFIX} </span>
            {kudos.author.email}{" "}
            <span data-testid="kudos-time">
              {TIME_PREFIX} {relative}
            </span>
          </p>
        </div>

        {leadActions !== undefined ? (
          <div className="ml-1 flex flex-none items-center gap-1">
            {leadActions}
          </div>
        ) : null}
      </div>

      <p
        data-testid="kudos-message"
        className="mt-3.5 whitespace-pre-line break-words text-body-m text-foreground"
      >
        {kudos.message}
      </p>

      <div className="mt-4">
        <ReactionPicker
          kudosId={kudos.id}
          reactions={reactions}
          onReactionSaved={onReactionSaved}
          onUnauthorized={onUnauthorized}
        />
      </div>
    </article>
  );
}

export default KudosCard;
