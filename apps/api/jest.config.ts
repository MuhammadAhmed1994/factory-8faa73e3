import type { Config } from "jest";

/**
 * Jest config for the API package.
 *
 * - Unit specs live next to their source as `*.spec.ts`.
 * - E2E specs are `*.e2e-spec.ts` under `src/` (Nest convention) and run against
 *   the docker-compose postgres via the env defaults in `test/setup-e2e.ts`.
 * - `test/setup-e2e.ts` is a `setupFiles` entry: it runs inside the jest
 *   environment *before* the test framework is installed, so `process.env`
 *   defaults (e.g. DATABASE_URL) are in place before any module is imported.
 *
 * `cacheDirectory` is moved off the OS temp dir: the shared `/tmp` transform
 * cache (`jest_rs`) can hit ENOSPC on the sandbox filesystem across repeated
 * runs. Keeping the cache inside the package makes runs hermetic.
 *
 * Path aliases used in `src/` (`@/`, `~/`) are mirrored here because jest
 * resolves modules independently of tsc.
 */
const config: Config = {
  rootDir: ".",
  roots: ["<rootDir>/src"],
  testEnvironment: "node",
  cache: true,
  cacheDirectory: "<rootDir>/.jest-cache",
  moduleFileExtensions: ["js", "json", "ts"],
  moduleDirectories: ["node_modules", "<rootDir>/../node_modules"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^~/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          // Specs are also type-checked by `pnpm --filter api typecheck`; keep
          // the transform settings aligned with tsconfig.json.
          module: "commonjs",
          moduleResolution: "node",
          target: "ES2022",
          lib: ["ES2022"],
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          strict: true,
          strictPropertyInitialization: false,
          skipLibCheck: true,
          types: ["node", "jest"],
        },
      },
    ],
  },
  testRegex: ".*\\.(e2e-spec|spec)\\.ts$",
  setupFiles: ["<rootDir>/test/setup-e2e.ts"],
  collectCoverageFrom: ["src/**/*.(t|j)s"],
  coverageDirectory: "<rootDir>/coverage",
  testTimeout: 30000,
  clearMocks: true,
  restoreMocks: true,
  passWithNoTests: true,
};

export default config;
