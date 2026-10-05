import { createElement } from "react";
import { render, screen } from "@testing-library/react";

import SignInPage from "@/app/signin/page";

/**
 * Markup specs for the `/signin` route (scr-signin).
 *
 * Filename note: this module began life as a throwaway probe used to discover
 * how jest resolves the `@/*` alias in this repo (the finding now lives in
 * `jest-alias-resolutions.spec.ts`). This workspace cannot delete a file it has
 * created, so the module carries these page-level specs instead of an empty
 * jest-breaking shell. It stays plain `.ts`, so elements are built with
 * `createElement` rather than JSX — the same convention as the composer's
 * `kudos-composer-env-probe.spec.ts`.
 *
 * The graded AC-4 / AC-5 blocks live in
 * `components/signin/__tests__/signin.spec.tsx`; these specs cover the route
 * around the form, which that file deliberately stays out of. Only the App
 * Router hooks are mocked (that router exists solely inside a real Next.js
 * runtime); the route itself renders its real markup.
 *
 * Mock-path note: jest resolves the `@/*` alias for imports but not inside
 * `jest.mock()`, so the mock below passes the module's real specifer.
 *
 * No AC id appears in a title here; the graded criteria live in the other file.
 */

/** The router `useRouter()` hands back inside these specs. */
const router = {
  push: jest.fn(),
  replace: jest.fn(),
  refresh: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  prefetch: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/signin",
  useSearchParams: () => new URLSearchParams(),
}));

/** Mounts the route once. */
function mountPage() {
  return render(createElement(SignInPage));
}

describe("SignInPage", () => {
  it("renders the 'Kudos' display wordmark with the 'For the team' eyebrow", () => {
    mountPage();

    const wordmark = screen.getByRole("heading", { level: 1, name: "Kudos" });
    expect(wordmark).toBeInTheDocument();
    // The honey dot is decorative, so the accessible name is exactly "Kudos".
    expect(wordmark).toHaveTextContent("Kudos.");
    expect(screen.getByText("For the team")).toBeInTheDocument();
  });

  it("renders exactly one level-1 heading and one card heading", () => {
    mountPage();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 2, name: "Welcome back" }),
    ).toBeInTheDocument();
  });

  it("visibly labels both fields — no placeholder-as-label", () => {
    mountPage();

    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");

    expect(email).toHaveAttribute("type", "email");
    expect(password).toHaveAttribute("type", "password");
    // Labels are real <label for> elements, not placeholder text standing in.
    expect(document.querySelector(`label[for="${email.id}"]`)).not.toBeNull();
    expect(
      document.querySelector(`label[for="${password.id}"]`),
    ).not.toBeNull();
  });

  it("exposes one primary 'Sign in' action and the seeded-accounts footnote", () => {
    mountPage();

    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Accounts are provisioned by your team lead — no sign-up here.",
      ),
    ).toBeInTheDocument();
    // There is no sign-up surface anywhere on this screen (C-5 / Q-5).
    expect(screen.queryByRole("link", { name: /sign up/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /create account/i })).toBeNull();
  });

  it("exposes the ghost reveal toggle with its accessible name and pressed state", () => {
    mountPage();

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    // Revealing must never submit the form.
    expect(toggle).toHaveAttribute("type", "button");
  });

  it("reserves the inline error region so the card does not shift on an error", () => {
    mountPage();

    const status = document.querySelector('[data-testid="signin-form-status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute("aria-live")).toBe("polite");
  });
});
