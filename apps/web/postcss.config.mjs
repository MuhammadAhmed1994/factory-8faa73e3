/**
 * PostCSS pipeline for the web package.
 *
 * `tailwindcss` maps the UxDesign tokens (see `tailwind.config.ts` and the CSS
 * variables in `app/globals.css`); `autoprefixer` covers the browser matrix.
 * Written as ESM to sit alongside `next.config.ts`.
 */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
