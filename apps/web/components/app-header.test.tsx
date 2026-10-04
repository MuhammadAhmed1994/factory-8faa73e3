import { render, screen } from "@testing-library/react";

import AppHeader, { SignOutButton } from "@/components/app-header";
import type { SessionMember } from "@/lib/api-client";

/**
 * Scaffold smoke specs for the role-aware app shell.
 *
 * This foundation task carries no acceptance-criteria ids — these specs exist
 * to prove the jest + jsdom + testing-library runner is wired and green before
 * any feature spec lands, and to pin the AppHeader contract later tasks rely on
 * (wordmark, email, lead-only badge, ghost sign-out).
 */
describe("AppHeader", () => {
  const member = (overrides?: Partial<SessionMember>): SessionMember => ({
    email: "member@kudos.local",
    role: "MEMBER",
    ...overrides,
  });

  it("renders the 'Kudos' wordmark", () => {
    render(<AppHeader member={member()} />);
    expect(
      screen.getByRole("link", { name: "Kudos — home" }),
    ).toHaveTextContent("Kudos");
  });

  it("shows the signed-in member's email", () => {
    render(<AppHeader member={member({ email: "member@kudos.local" })} />);
    expect(screen.getByText("member@kudos.local")).toBeInTheDocument();
  });

  it("hides the Lead badge when role is MEMBER", () => {
    render(<AppHeader member={member({ role: "MEMBER" })} />);
    expect(screen.queryByTestId("lead-badge")).not.toBeInTheDocument();
  });

  it("renders the Lead badge when role is LEAD", () => {
    render(<AppHeader member={member({ role: "LEAD" })} />);
    expect(screen.getByTestId("lead-badge")).toHaveTextContent("Lead");
  });

  it("renders a ghost Sign out button when signed in", () => {
    render(<AppHeader member={member()} />);
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  it("still renders Sign out when actions are provided", () => {
    render(<AppHeader member={member()} actions={<SignOutButton />} />);
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });

  it("renders the wordmark alone when signed out", () => {
    render(<AppHeader member={null} />);
    expect(
      screen.getByRole("link", { name: "Kudos — home" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("member@kudos.local")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});
