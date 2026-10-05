import type { Config } from "jest";

/**
 * Jest config for the API package.
 *
 * - Targets `*.e2e-spec.ts` specs living under `src/`.
 * - `test/setup-e2e.ts` runs as a `setupFiles` hook, i.e. *before* the test
 *   framework and before any spec module is imported, so env defaults such as
 *   `DATABASE_URL` (pointing at the docker-compose postgres) are in place for
 *   every spec run. No `.env` file is read; defaults live in `src/app.config.ts`.
 */
const config: Config = {
  rootDir: ".",
  roots: ["<rootDir>/src"],
  testEnvironment: "node",
  testRegex: ".*\\.e2e-spec\\.ts$",
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  setupFiles: ["<rootDir>/test/setup-e2e.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  clearMocks: true,
  testTimeout: 30000,
};

export default config;
