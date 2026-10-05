"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";

/** Props for {@link SignOutButton}. */
export interface SignOutButtonProps {
  /**
   * Optional sign-out handler, e.g. a `"use server"` action that clears the
   * httpOnly session cookie. No logout endpoint exists in the v1 API contract,
   * so by default the control simply returns the member to `/signin`.
   */
  readonly onSignOut?: () => void | Promise<void>;
}

/**
 * The ghost `Sign out` control of the app header.
 *
 * This is the only interactive piece of the header, so it is the only part that
 * needs to be a Client Component — the surrounding `AppHeader` stays on the
 * server and keeps the client boundary as small as possible.
 */
export function SignOutButton({ onSignOut }: SignOutButtonProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (onSignOut) {
        await onSignOut();
        return;
      }
      router.replace("/signin");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={signingOut}
      data-testid="app-header-sign-out"
      className="rounded-control px-3 py-1.5 text-body-s text-muted-foreground transition-colors duration-base hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );
}

export default SignOutButton;
