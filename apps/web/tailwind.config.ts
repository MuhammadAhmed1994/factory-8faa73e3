import type { Config } from "tailwindcss";

/**
 * UxDesign token mapping (`warm-editorial-minimal`).
 *
 * Every colour, radius, shadow and duration resolves to a CSS variable declared
 * exactly once in `app/globals.css`, so a palette change is a one-file edit and
 * components never hardcode hex values. The amber accent is spent only on
 * celebration: primary actions, the viewer's own reaction and new arrivals.
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
          foreground: "var(--accent-foreground)",
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
        success: {
          DEFAULT: "var(--success)",
          foreground: "var(--success-foreground)",
        },
        info: {
          DEFAULT: "var(--info)",
          foreground: "var(--info-foreground)",
        },
        ring: "var(--ring)",
      },
      fontFamily: {
        heading: ["var(--font-heading)"],
        sans: ["var(--font-body)"],
      },
      fontSize: {
        display: [
          "28px",
          { lineHeight: "34px", letterSpacing: "-0.01em", fontWeight: "800" },
        ],
        "heading-m": [
          "20px",
          { lineHeight: "26px", letterSpacing: "-0.005em", fontWeight: "700" },
        ],
        "heading-s": [
          "16px",
          { lineHeight: "22px", letterSpacing: "0em", fontWeight: "600" },
        ],
        "body-m": ["15px", { lineHeight: "22px", fontWeight: "400" }],
        "body-s": ["13px", { lineHeight: "18px", fontWeight: "500" }],
        caption: ["12px", { lineHeight: "16px", fontWeight: "400" }],
        overline: [
          "11px",
          { lineHeight: "14px", letterSpacing: "0.08em", fontWeight: "600" },
        ],
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
      },
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
        slow: "var(--motion-slow)",
      },
      transitionTimingFunction: {
        enter: "var(--ease-enter)",
        exit: "var(--ease-exit)",
      },
      keyframes: {
        /**
         * Arrival highlight: the amber wash fades off a newly arrived card over
         * ~1.2s. Scoped to `.kudos-card[data-arriving]` and collapsed to a
         * 200ms opacity fade under `prefers-reduced-motion`.
         */
        "kudos-arrival": {
          "0%": {
            backgroundColor: "var(--accent-soft)",
            borderColor: "var(--accent)",
          },
          "100%": {
            backgroundColor: "var(--card)",
            borderColor: "var(--border)",
          },
        },
      },
      animation: {
        "kudos-arrival": "kudos-arrival var(--motion-arrival) var(--ease-enter) both",
      },
      screens: {
        sm: "375px",
        md: "768px",
        lg: "1024px",
        xl: "1440px",
      },
    },
  },
  plugins: [],
};

export default config;
