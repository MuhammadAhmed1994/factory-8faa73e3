import Link from "next/link";
import type { ReactNode } from "react";

import type { SessionMember } from "@/lib/api-client";

/**
 * AppHeader — the role-aware app shell chrome (cmp-app-header).
 *
 * Server Component: the signed-in member is resolved server-side by
 * `lib/session.ts` and passed down as a plain prop, so no auth state is
 * reconstructed in the browser.
 *
 * States:
 * - `member`: wordmark + email + ghost "Sign out".
 * - `lead`: additionally renders the `Lead` role badge next to the email.
 * - Signed out (`member === null`): wordmark only, so `/signin` can reuse the
 *   shell without leaking a session that does not exist.
 */

export interface AppHeaderProps {
  /** Signed-in member, or `null` when unauthenticated. */
  member?: SessionMember | null;
  /** Replaces the default trailing controls (e.g. with a "Sign in" action). */
  actions?: ReactNode;
}

/** "Lead" role badge (cmp-badge, `role` variant). */
function LeadBadge() {
  return (
    <span
      className="type-overline inline-flex items-center rounded-pill border border-accent-soft bg-accent-soft px-2 py-0.5 text-foreground"
      data-testid="lead-badge"
      title="This member can hide kudos from the board"
    >
      Lead
    </span>
  );
}

/**
 * Ghost "Sign out" button (secondary, low-emphasis — it is not the screen's
 * primary action). Presentational: the sign-out flow is wired by the auth task.
 */
export function SignOutButton({
  onClick,
  type = "button",
  children = "Sign out",
}: {
  onClick?: () => void;
  type?: "button" | "submit";
  children?: ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      data-testid="sign-out"
      className="type-body-s rounded-control border border-transparent bg-transparent px-3 py-1.5 font-medium text-muted-foreground transition-colors duration-base hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

export function AppHeader({ member, actions }: AppHeaderProps) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="type-heading-s font-heading font-bold text-foreground no-underline"
          aria-label="Kudos — home"
        >
          Kudos
        </Link>

        <div className="flex items-center gap-3">
          {member ? (
            <>
              <span
                className="type-body-s hidden text-muted-foreground sm:inline"
                data-testid="member-email"
              >
                {member.email}
              </span>
              {member.role === "LEAD" ? <LeadBadge /> : null}
              {actions ?? <SignOutButton />}
            </>
          ) : (
            actions
          )}
        </div>
      </div>
    </header>
  );
}

export default AppHeader;
