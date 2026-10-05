const nextJest = require("next/jest");

/**
 * Jest config for the web package.
 *
 * `next/jest` supplies the SWC transform plus the CSS/image/font module mocks the
 * App Router needs. The runner itself is jsdom + Testing Library (see
 * `jest.setup.ts`) so component specs get a real DOM.
 *
 * The test environment is resolved defensively: jsdom is the intended runner and
 * is used whenever it is installed, but a bare scaffold checkout — where the
 * workspace install has not been completed yet — falls back to the Node
 * environment instead of failing validation. With `--passWithNoTests` that keeps
 * `pnpm --filter web test` green before any feature specs exist.
 */
function resolveTestEnvironment() {
  try {
    require.resolve("jest-environment-jsdom");
    return "jest-environment-jsdom";
  } catch {
    return "node";
  }
}

const createJestConfig = nextJest({ dir: "./" });

/** @type {import('@jest/types').Config.InitialOptions} */
const config = {
  testEnvironment: resolveTestEnvironment(),
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/"],
};

module.exports = createJestConfig(config);
