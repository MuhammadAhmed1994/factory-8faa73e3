import type { Metadata } from "next";

import SignInForm from "@/components/signin/signin-form";

/**
 * `/signin` — scr-signin, the only entrance to the app (US-1, constraint C-5:
 * email + password, nothing else).
 *
 * Layout follows the screen's three regions exactly, in a single centred
 * 400px column:
 *
 * - `r-brand`   the "Kudos" display wordmark with the "For the team" eyebrow.
 * - `r-form`    the white auth card: "Welcome back" heading, visibly labelled
 *               Email and Password fields (PasswordInput wraps the shared
 *               Input plus the ghost eye toggle), one primary "Sign in", and
 *               the reserved inline error region.
 * - `r-helper`  the footnote "Accounts are provisioned by your team lead —
 *               no sign-up here." — there is no sign-up link anywhere.
 *
 * This route is a Server Component; only the form itself is a client island
 * (`components/signin/signin-form.tsx`). The card keeps ≥16px horizontal
 * margin below 480px, and below the card the reserved error region means the
 * layout never shifts between the error and success states.
 */
export const metadata: Metadata = {
  title: "Sign in to Kudos",
  description:
    "Sign in with your team email and password to post kudos and watch the live board.",
};

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[452px] flex-col justify-center px-5 py-12 sm:px-[26px]">
      {/* r-brand · Brand header */}
      <header className="flex items-center gap-3 px-0.5">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 flex-none items-center justify-center rounded-card bg-primary text-primary-foreground shadow-card"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-5 w-5"
          >
            <path d="M19.414 14.414C21 12.828 22 11.5 22 9.5a5.5 5.5 0 0 0-9.591-3.676a.6.6 0 0 1-.818.001A5.5 5.5 0 0 0 2 9.5c0 2.3 1.5 4 3 5.5l5.535 5.362a2 2 0 0 0 2.879.052a2.12 2.12 0 0 0-.004-3a2.124 2.124 0 1 0 3-3a2.124 2.124 0 0 0 3.004 0a2 2 0 0 0 0-2.828l-1.881-1.882a2.41 2.41 0 0 0-3.409 0l-1.71 1.71a2 2 0 0 1-2.828 0a2 2 0 0 1 0-2.828l2.823-2.762" />
          </svg>
        </span>
        <div>
          <p className="type-overline text-muted-foreground">For the team</p>
          {/*
            The display wordmark. `h1` is the page's only level-1 heading; the
            trailing honey dot is decorative (aria-hidden) — the accessible
            name stays exactly "Kudos".
          */}
          <h1 className="type-display font-heading mt-0.5 font-extrabold">
            Kudos
            <span aria-hidden="true" className="text-accent">
              .
            </span>
          </h1>
        </div>
      </header>

      {/* r-form · Sign-in card */}
      <section
        aria-labelledby="welcome-heading"
        className="mt-6 rounded-card border border-border bg-card px-6 py-8 shadow-card"
      >
        <h2 id="welcome-heading" className="type-heading-m font-heading font-bold">
          Welcome back
        </h2>
        <p className="type-body-s mt-1.5 text-muted-foreground">
          Use your team email and password.
        </p>

        <SignInForm className="mt-7" />
      </section>

      {/* r-helper · Helper footnote */}
      <p className="type-caption mt-5 px-0.5 text-muted-foreground">
        Accounts are provisioned by your team lead — no sign-up here.
      </p>
    </main>
  );
}
