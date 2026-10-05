import type { MemberRole } from "@/lib/api-client";
import { SignOutButton } from "./sign-out-button";

/** Props for {@link AppHeader}. */
export interface AppHeaderProps {
  /** Email of the signed-in member, shown next to the wordmark. */
  readonly email: string;
  /** The `Lead` badge renders only when this is `LEAD` (ADR-2). */
  readonly role: MemberRole;
  /**
   * Optional sign-out handler forwarded to the sign-out control — pass a
   * `"use server"` action here once a logout endpoint exists.
   */
  readonly onSignOut?: () => void | Promise<void>;
}

/**
 * Role-aware app shell header (`cmp-app-header`).
 *
 * Renders the `Kudos` wordmark, the signed-in member's email, a `Lead` badge
 * only for the lead role, and a ghost `Sign out` control. Chrome recedes —
 * neutral colours, no accent — because the amber is reserved for the moment of
 * giving thanks; moderation stays quiet by design.
 *
 * A Server Component: the board page resolves the member server-side (ADR-1)
 * and passes the props down. Only the inner {@link SignOutButton} island is
 * client-side, keeping the client boundary as small as possible.
 */
export function AppHeader({ email, role, onSignOut }: AppHeaderProps) {
  const isLead = role === "LEAD";

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-3 sm:px-6">
        <span className="font-heading text-heading-s text-foreground">
          Kudos
        </span>

        <div className="ml-auto flex items-center gap-2">
          <span
            className="text-body-s text-muted-foreground"
            data-testid="app-header-email"
          >
            {email}
          </span>

          {isLead ? (
            <span
              className="rounded-pill border border-border bg-muted px-2 py-0.5 text-overline uppercase text-muted-foreground"
              data-testid="app-header-lead-badge"
            >
              Lead
            </span>
          ) : null}

          <SignOutButton onSignOut={onSignOut} />
        </div>
      </div>
    </header>
  );
}

export default AppHeader;
