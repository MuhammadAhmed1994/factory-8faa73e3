import type { Config } from "tailwindcss";

/**
 * Tailwind theme for the Team Kudos Board.
 *
 * Every colour here resolves to the CSS variables declared in
 * `app/globals.css`, so the palette lives in exactly one file: changing a token
 * value there re-themes the whole app. Components use these Tailwind names
 * (e.g. `bg-card`, `text-muted-foreground`, `rounded-card`) and never hardcode
 * hex values.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          soft: "var(--accent-soft)",
          foreground: "var(--foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        border: "var(--border)",
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        success: "var(--success)",
        info: "var(--info)",
        ring: "var(--ring)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        control: "var(--radius-control)",
        card: "var(--radius-card)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        popover: "var(--shadow-popover)",
        focus: "0 0 0 2px rgba(180, 83, 9, 0.45)",
      },
      fontFamily: {
        heading: ["var(--font-heading)"],
        body: ["var(--font-body)"],
      },
      fontSize: {
        display: ["28px", { lineHeight: "34px", letterSpacing: "-0.01em" }],
        "heading-m": ["20px", { lineHeight: "26px", letterSpacing: "-0.005em" }],
        "heading-s": ["16px", { lineHeight: "22px" }],
        "body-m": ["15px", { lineHeight: "22px" }],
        "body-s": ["13px", { lineHeight: "18px" }],
        caption: ["12px", { lineHeight: "16px" }],
        overline: [
          "11px",
          { lineHeight: "14px", letterSpacing: "0.08em" },
        ],
      },
      transitionTimingFunction: {
        enter: "cubic-bezier(0.16, 1, 0.3, 1)",
        exit: "cubic-bezier(0.4, 0, 1, 1)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        slow: "320ms",
      },
      screens: {
        xs: "375px",
        sm: "768px",
        md: "1024px",
        lg: "1440px",
      },
    },
  },
  plugins: [],
};

export default config;
