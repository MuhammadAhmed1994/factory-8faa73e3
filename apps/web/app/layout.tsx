import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

/**
 * Root layout for the Team Kudos Board web app.
 *
 * - Fonts are loaded exactly per the UX `fonts_import` note: Plus Jakarta Sans
 *   for headings and Inter for body copy, via Google Fonts with both
 *   preconnects, so no layout shift is caused by a late stylesheet fetch.
 * - The CSS variables in `globals.css` carry the whole Warm Editorial Minimal
 *   palette; nothing here hardcodes a colour.
 */
export const metadata: Metadata = {
  title: "Team Kudos Board",
  description:
    "Post short kudos to a colleague and watch the team's live gratitude board.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

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
        {/* Plus Jakarta Sans (headings, 600/700/800) + Inter (body, 400/500/600) */}
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-background font-body text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
