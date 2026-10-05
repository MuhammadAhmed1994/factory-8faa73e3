import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Team Kudos Board",
    template: "%s · Team Kudos Board",
  },
  description:
    "Post short kudos to a colleague and watch the team's live gratitude board.",
};

/**
 * Root layout for the kudos web app.
 *
 * Plus Jakarta Sans (headings) and Inter (body) load through the single Google
 * Fonts stylesheet, preceded by both preconnects so the CSS fetch starts warm.
 * The two families are exposed to the rest of the app as the `--font-heading`
 * and `--font-body` variables in `app/globals.css`.
 *
 * Route chrome (the role-aware `AppHeader`) is rendered by the pages that need
 * it rather than here, so the sign-in screen stays free of board chrome.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
