const nextJest = require("next/jest");

/**
 * Jest config for the web package.
 *
 * - jsdom + @testing-library/react so later component specs (sign-in form,
 *   composer, board) run in a browser-like environment.
 * - `jest.setup.ts` pulls in the `@testing-library/jest-dom` matchers.
 * - `next/jest` reads the `paths` alias (`@/*`) from tsconfig.json and stubs
 *   CSS/asset imports, so components render as-is.
 *
 * The toolchain hoists the jest/testing-library packages to the workspace root
 * with pnpm, so nothing extra is added to this package's devDependencies — but
 * it provisions `jsdom` without the thin `jest-environment-jsdom` wrapper. Jest
 * resolves `testEnvironment` from this file's directory and never walks up to
 * the workspace root, so the real package is preferred when present and the
 * equivalent local wrapper (`jest/jsdom-environment.cjs`) is used otherwise.
 */
const createJestConfig = nextJest({ dir: "./" });

/** True when the official jsdom environment package is resolvable. */
function hasOfficialJsdomEnvironment() {
  try {
    require.resolve("jest-environment-jsdom");
    return true;
  } catch {
    return false;
  }
}

module.exports = createJestConfig({
  testEnvironment: hasOfficialJsdomEnvironment()
    ? "jest-environment-jsdom"
    : "<rootDir>/jest/jsdom-environment.cjs",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  clearMocks: true,
  restoreMocks: true,
  passWithNoTests: true,
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/"],
});
