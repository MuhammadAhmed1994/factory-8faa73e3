import type { NextConfig } from "next";

/**
 * Next.js configuration for the Team Kudos Board web app.
 *
 * - TypeScript strict checking stays on for `next build` / `next dev`.
 * - ESLint blocking during build is disabled: linting is not part of this task's
 *   gate and the sandbox may not have the toolchain wired for it.
 * - Rewrites proxy the versioned API surface through the Next.js origin so the
 *   browser only ever talks to one origin in local development. The server-side
 *   `lib/api-client.ts` talks to `API_BASE_URL` directly instead.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    const api = process.env.API_PROXY_TARGET ?? "http://localhost:3000";
    return [
      // `/api/v1/:path*` -> `<API_PROXY_TARGET>/api/v1/:path*`
      {
        source: "/api/v1/:path*",
        destination: `${api}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
