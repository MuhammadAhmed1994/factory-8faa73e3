import type { Metadata } from "next";
import { SignInForm } from "../../components/signin/signin-form";

/**
 * `/signin` — `scr-signin`, the only entrance to the app (C-5).
 *
 * Three narrow rows on the warm canvas: the brand header (`Kudos` display
 * wordmark with the `For the team` eyebrow), the sign-in card (`Welcome back`,
 * labelled email + password fields, one primary `Sign in`, the reserved inline
 * status region) and the helper footnote that manages expectations for the
 * seeded accounts — there is no sign-up anywhere.
 *
 * The single centred column is capped at 400px from 320px up, and the card keeps
 * a ≥16px horizontal margin below 480px.
 *
 * Imports use a relative path (not the `@/` alias) so the file resolves
 * identically under `tsc`, Next.js and Jest, whose `moduleNameMapper` is not
 * editable in this workspace.
 */

export const metadata: Metadata = {
  title: "Sign in to Kudos",
  description:
    "Sign in with your team email and password to post kudos and watch the live board.",
};

/** Lucide `heart-handshake`, the brand mark's glyph. Decorative. */
function BrandMarkIcon() {
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
      className="h-[21px] w-[21px]"
    >
      <path d="M19.414 14.414C21 12.828 22 11.5 22 9.5a5.5 5.5 0 0 0-9.591-3.676a.6.6 0 0 1-.818.001A5.5 5.5 0 0 0 2 9.5c0 2.3 1.5 4 3 5.5l5.535 5.362a2 2 0 0 0 2.879.052a2.12 2.12 0 0 0-.004-3a2.124 2.124 0 1 0 3-3a2.124 2.124 0 0 0 3.004 0a2 2 0 0 0 0-2.828l-1.881-1.882a2.41 2.41 0 0 0-3.409 0l-1.71 1.71a2 2 0 0 1-2.828 0a2 2 0 0 1 0-2.828l2.823-2.762" />
    </svg>
  );
}

/**
 * The sign-in screen. A Server Component: the only client island is the form
 * itself, which owns field state and the pending request.
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-[400px] flex-col">
        {/* r-brand · Brand header */}
        <header className="flex items-center gap-3 px-0.5">
          <span
            aria-hidden="true"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-card bg-primary text-primary-foreground shadow-card"
          >
            <BrandMarkIcon />
          </span>

          <div>
            <p className="text-overline uppercase text-muted-foreground">
              For the team
            </p>
            <h1 className="mt-0.5 font-heading text-display text-foreground">
              Kudos<span className="text-accent">.</span>
            </h1>
          </div>
        </header>

        {/* r-form · Sign-in card */}
        <section
          aria-labelledby="welcome-heading"
          className="mt-6 w-full rounded-card border border-border bg-card p-6 shadow-card"
        >
          <h2
            id="welcome-heading"
            className="font-heading text-heading-m text-foreground"
          >
            Welcome back
          </h2>
          <p className="mt-1.5 text-body-s text-muted-foreground">
            Use your team email and password.
          </p>

          <SignInForm />
        </section>

        {/* r-helper · Helper footnote — no sign-up exists, by design (Q-5). */}
        <p className="mt-5 px-0.5 text-caption text-muted-foreground">
          Accounts are provisioned by your team lead — no sign-up here.
        </p>
      </div>
    </main>
  );
}
