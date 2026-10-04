import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";

import {
  ApiError,
  DEFAULT_API_BASE_URL,
  resolveApiBaseUrl,
} from "@/lib/api-client";

/**
 * Scaffold specs for the web package foundation.
 *
 * This task carries no acceptance-criteria ids. These specs pin the contracts
 * everything else is built on: the exact UxDesign CSS variables in
 * `app/globals.css`, the typed API client's base-URL resolution and its
 * `ApiError` status/message/field mapping (what 401/403/400 handling branches
 * on), the package scripts, the fonts import, and the middleware split.
 */
describe("web scaffold design tokens", () => {
  const globalsCss = readFileSync(join(__dirname, "app", "globals.css"), "utf8");

  it("declares the exact UxDesign palette variables", () => {
    const expected: Record<string, string> = {
      "--background": "#FBF8F3",
      "--foreground": "#2A2622",
      "--card": "#FFFFFF",
      "--primary": "#B45309",
      "--accent": "#E8A33D",
      "--accent-soft": "#FBEED9",
      "--muted": "#F1EBE1",
      "--muted-foreground": "#6E655A",
      "--border": "#E4DCCC",
      "--destructive": "#B3261E",
      "--ring": "#B45309",
    };
    for (const [token, hex] of Object.entries(expected)) {
      expect(globalsCss).toContain(`${token}: ${hex};`);
    }
  });

  it("declares the 6/10/14/999px radii", () => {
    expect(globalsCss).toContain("--radius-sm: 6px;");
    expect(globalsCss).toContain("--radius-control: 10px;");
    expect(globalsCss).toContain("--radius-card: 14px;");
    expect(globalsCss).toContain("--radius-pill: 999px;");
  });
});

describe("web scaffold API client", () => {
  it("defaults the base URL to the local NestJS API", () => {
    expect(DEFAULT_API_BASE_URL).toBe("http://localhost:3000/api/v1");
    expect(resolveApiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
  });

  it("lets callers override the base URL in code", () => {
    expect(resolveApiBaseUrl("http://api.example.com/api/v1/")).toBe(
      "http://api.example.com/api/v1",
    );
  });

  it("carries status and message on ApiError", () => {
    const error = new ApiError(401, "Unauthorized", {
      statusCode: 401,
      message: "Unauthorized",
    });
    expect(error.status).toBe(401);
    expect(error.message).toBe("Unauthorized");
    expect(error.isUnauthenticated).toBe(true);
    expect(error.isForbidden).toBe(false);
    expect(error.isValidation).toBe(false);
  });

  it("maps 400 payloads to inline field errors", () => {
    const error = new ApiError(400, "Bad Request", {
      statusCode: 400,
      message: [
        { property: "message", constraints: { isLength: "message too long" } },
      ],
    });
    expect(error.isValidation).toBe(true);
    expect(error.fields).toEqual({ message: "message too long" });
  });
});

describe("web scaffold configuration", () => {
  const read = (...parts: string[]): string =>
    readFileSync(join(__dirname, ...parts), "utf8");

  it("declares dev/build/test scripts with jest --passWithNoTests", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts.dev).toBe("next dev");
    expect(pkg.scripts.build).toBe("next build");
    expect(pkg.scripts.test).toBe("jest --passWithNoTests");
    expect(pkg.devDependencies["jest-environment-jsdom"]).toBeDefined();
    expect(pkg.devDependencies["@testing-library/react"]).toBeDefined();
    expect(pkg.devDependencies["@testing-library/jest-dom"]).toBeDefined();
  });

  it("loads Plus Jakarta Sans + Inter through preconnected Google Fonts", () => {
    const layout = read("app", "layout.tsx");
    expect(layout).toContain(
      '<link rel="preconnect" href="https://fonts.googleapis.com"',
    );
    expect(layout).toContain('href="https://fonts.gstatic.com"');
    expect(layout).toContain("crossOrigin");
    expect(layout).toContain(
      "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap",
    );
  });

  it("keeps /signin and Next.js assets public while guarding /", () => {
    const middleware = read("middleware.ts");
    expect(middleware).toContain('"/signin"');
    expect(middleware).toContain('startsWith("/_next")');
    expect(middleware).toContain("NextResponse.redirect");
  });
});

describe("web scaffold jest environment", () => {
  it("renders components under jsdom with jest-dom matchers", () => {
    render(<button type="button">Send kudos</button>);
    expect(screen.getByRole("button", { name: "Send kudos" })).toBeEnabled();
  });
});
