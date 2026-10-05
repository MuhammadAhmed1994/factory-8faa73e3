import type { NextConfig } from "next";

/**
 * Next.js configuration for the kudos web app.
 *
 * The NestJS API base URL is resolved *in code* by `lib/api-client.ts`, so this
 * package owns no `.env` file. `NEXT_PUBLIC_API_BASE_URL` is still honoured when
 * the environment provides it, and is surfaced to the browser bundle here.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_API_BASE_URL:
      process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api/v1",
  },
};

export default nextConfig;
