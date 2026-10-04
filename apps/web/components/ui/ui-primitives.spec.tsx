import { act, cleanup, render, screen } from "@testing-library/react";

import Alert from "@/components/ui/alert";
import Avatar, { getAvatarHue, getInitials } from "@/components/ui/avatar";
import Badge from "@/components/ui/badge";
import Button, { buttonVariants } from "@/components/ui/button";
import Input, { type InputProps } from "@/components/ui/input";
import Skeleton from "@/components/ui/skeleton";
import { Toaster, dismissToast, toast } from "@/components/ui/toaster";

/**
 * Specs for the seven shared UI primitives (cmp-button, cmp-input, cmp-alert,
 * cmp-badge, cmp-avatar, cmp-skeleton, cmp-toast).
 *
 * Foundation task with no acceptance-criteria ids: these pin the contracts the
 * later screen tasks build on — every variant/state renders, styling resolves
 * only to T-10 design tokens (never a hardcoded hex), the amber focus ring is
 * never removed, loading disables interaction, the input error state sets
 * aria-invalid, the Alert is announced, the Avatar is decorative and
 * deterministic, the Skeleton is static under reduced motion, and the Toaster
 * surfaces action feedback only.
 */

const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const hexIn = (v: string): string[] => v.match(HEX) ?? [];

function classOf(scope: HTMLElement, sel: string): string {
  const el = scope.querySelector(sel);
  expect(el).not.toBeNull();
  return (el as HTMLElement).className;
}

/** A labelled field, the way real screens wire their inputs up. */
function Field({ id, label, ...rest }: { id: string; label: string } & InputProps) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <Input id={id} {...rest} />
    </div>
  );
}

const VARIANTS = ["primary", "secondary", "ghost", "destructive"] as const;

describe("Button (cmp-button)", () => {
  it("renders every variant with the always-visible amber focus ring", () => {
    const { container } = render(
      <div>
        {VARIANTS.map((v) => (
          <Button key={v} variant={v}>{v}</Button>
        ))}
      </div>,
    );
    for (const v of VARIANTS) {
      const cls = classOf(container, `[data-variant="${v}"]`);
      expect(cls).toContain("rounded-control");
      expect(cls).toContain("focus-visible:ring-2");
      expect(cls).toContain("focus-visible:ring-ring");
      expect(cls).toContain("focus-visible:ring-offset-2");
      expect(hexIn(cls)).toHaveLength(0);
    }
  });

  it("maps primary/secondary/destructive/ghost to their palette tokens", () => {
    const { container } = render(
      <div>
        <Button variant="primary">p</Button>
        <Button variant="secondary">s</Button>
        <Button variant="destructive">d</Button>
        <Button variant="ghost">g</Button>
      </div>,
    );
    expect(classOf(container, '[data-variant="primary"]')).toContain("bg-primary");
    expect(classOf(container, '[data-variant="primary"]')).toContain("text-primary-foreground");
    expect(classOf(container, '[data-variant="secondary"]')).toContain("bg-secondary");
    expect(classOf(container, '[data-variant="destructive"]')).toContain("bg-destructive");
    expect(classOf(container, '[data-variant="ghost"]')).toContain("hover:bg-muted");
  });

  it("carries hover and active classes on the filled variants", () => {
    for (const v of ["primary", "secondary", "destructive"] as const) {
      expect(buttonVariants({ variant: v })).toContain("hover:shadow-card-hover");
      expect(buttonVariants({ variant: v })).toContain("active:shadow-card");
    }
    expect(buttonVariants({ variant: "secondary", size: "sm" })).toContain("bg-secondary");
  });

  it("renders disabled without a spinner, and loading with one", () => {
    render(<Button disabled>Send kudos</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
    expect(screen.queryByTestId("button-spinner")).toBeNull();
    cleanup();
    render(<Button loading>Send kudos</Button>);
    const b = screen.getByRole("button");
    expect(b).toBeDisabled();
    expect(screen.getByTestId("button-spinner")).toBeInTheDocument();
    expect(b).toHaveAttribute("aria-busy", "true");
    expect(b.className).toContain("disabled:pointer-events-none");
  });

  it("loading disables even when disabled is false", () => {
    render(<Button loading disabled={false}>Send kudos</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("defaults to type=button and primary, forwarding native attributes", () => {
    render(<Button id="send" type="submit" form="composer">Send kudos</Button>);
    const b = screen.getByRole("button");
    expect(b).toHaveAttribute("type", "submit");
    expect(b).toHaveAttribute("id", "send");
    expect(b).toHaveAttribute("form", "composer");
    expect(b).toHaveAttribute("data-variant", "primary");
  });
});

describe("Input (cmp-input)", () => {
  it("renders default/focus/disabled states from tokens", () => {
    render(<Field id="email" label="Email" placeholder="you@team.com" type="email" />);
    const i = screen.getByLabelText("Email");
    expect(i).toHaveAttribute("id", "email");
    expect(i).toHaveAttribute("type", "email");
    expect(i.className).toContain("bg-muted");
    expect(i.className).toContain("border-border");
    expect(i.className).toContain("focus-visible:ring-ring");
    expect(i.className).toContain("focus-visible:ring-offset-2");
    expect(hexIn(i.className)).toHaveLength(0);
    cleanup();
    render(<Field id="email2" label="Email" disabled />);
    expect(screen.getByLabelText("Email")).toBeDisabled();
  });

  it("sets aria-invalid in the error state and omits it when valid", () => {
    render(<Field id="recipient" label="Recipient" invalid />);
    const i = screen.getByLabelText("Recipient");
    expect(i).toHaveAttribute("aria-invalid", "true");
    expect(i.className).toContain("border-destructive");
    expect(hexIn(i.className)).toHaveLength(0);
    cleanup();
    render(<Field id="recipient2" label="Recipient" invalid={false} />);
    expect(screen.getByLabelText("Recipient")).not.toHaveAttribute("aria-invalid");
  });

  it("forwards ids so captions wire up through aria-describedby", () => {
    render(
      <div>
        <label htmlFor="recipient">Recipient</label>
        <Input id="recipient" aria-describedby="cap err" />
        <p id="cap">Who is this kudos for?</p>
        <p id="err" role="alert">Enter a recipient name.</p>
      </div>,
    );
    expect(screen.getByLabelText("Recipient")).toHaveAttribute("aria-describedby", "cap err");
    expect(document.getElementById("cap")).not.toBeNull();
    expect(document.getElementById("err")).not.toBeNull();
  });
});

describe("Alert (cmp-alert)", () => {
  it("announces the notice via role=alert", () => {
    render(<Alert>That email and password combination is not right.</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That email and password combination is not right.",
    );
  });

  it("colours error with destructive and info with the info token", () => {
    const { container } = render(
      <div>
        <Alert variant="error" title="Sign-in failed">Check your details.</Alert>
        <Alert variant="info">Only team leads can hide kudos.</Alert>
      </div>,
    );
    const err = classOf(container, '[data-variant="error"]');
    const info = classOf(container, '[data-variant="info"]');
    expect(err).toContain("border-l-destructive");
    expect(err).toContain("text-destructive");
    expect(info).toContain("border-l-info");
    expect(info).toContain("text-info");
    expect(hexIn(err)).toHaveLength(0);
    expect(hexIn(info)).toHaveLength(0);
  });

  it("renders a bold title plus body and defaults to info", () => {
    render(<Alert title="Sign-in failed">Check your email and password.</Alert>);
    expect(screen.getByText("Sign-in failed").tagName).toBe("P");
    expect(screen.getByText("Check your email and password.").tagName).toBe("DIV");
    expect(screen.getByRole("alert")).toHaveAttribute("data-variant", "info");
  });
});

describe("Badge (cmp-badge)", () => {
  it("renders role, hidden and count variants in overline type", () => {
    const { container } = render(
      <div>
        <Badge variant="role">Lead</Badge>
        <Badge variant="hidden">Hidden</Badge>
        <Badge variant="count">3</Badge>
      </div>,
    );
    const role = classOf(container, '[data-variant="role"]');
    const hidden = classOf(container, '[data-variant="hidden"]');
    const count = classOf(container, '[data-variant="count"]');
    for (const cls of [role, hidden, count]) {
      expect(cls).toContain("type-overline");
      expect(cls).toContain("rounded-pill");
      expect(hexIn(cls)).toHaveLength(0);
    }
    expect(role).toContain("bg-accent-soft");
    expect(hidden).toContain("bg-muted");
    expect(hidden).toContain("text-muted-foreground");
    expect(count).toContain("tabular-nums");
  });

  it("defaults to the role variant", () => {
    render(<Badge>Lead</Badge>);
    expect(screen.getByText("Lead")).toHaveAttribute("data-variant", "role");
  });
});

describe("Avatar (cmp-avatar)", () => {
  it("is decorative and derives initials deterministically", () => {
    const { container } = render(
      <span>
        <Avatar name="Maya Patel" size="sm" />
        <span>Maya Patel</span>
      </span>,
    );
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("MP");
    expect(container.textContent).toContain("Maya Patel");
    expect(getInitials("  ada   lovelace  ")).toBe("AL");
    expect(getInitials("Cher")).toBe("C");
    expect(getInitials("   ")).toBe("•");
  });

  it("renders sm at 32px and md at 40px, defaulting to md", () => {
    const { container } = render(
      <div>
        <Avatar name="Maya Patel" size="sm" />
        <Avatar name="Sam Rivera" size="md" />
        <Avatar name="Ash Kim" />
      </div>,
    );
    expect(classOf(container, '[data-size="sm"]')).toContain("h-8");
    expect(classOf(container, '[data-size="sm"]')).toContain("w-8");
    expect(classOf(container, '[data-size="md"]')).toContain("h-10");
    expect(classOf(container, '[data-size="md"]')).toContain("w-10");
    expect(container.querySelectorAll('[data-size="md"]')).toHaveLength(2);
  });

  it("picks a deterministic warm hue from the token palette", () => {
    const first = getAvatarHue("Maya Patel");
    expect(getAvatarHue("Maya Patel")).toBe(first);
    const seen = new Set<string>();
    for (const n of ["Maya Patel", "Sam Rivera", "Jo Fox", "Ravi Nair", "Lena Ott"]) {
      const hue = getAvatarHue(n);
      seen.add(hue);
      expect(hue).toMatch(/^bg-(accent-soft|accent|muted|primary|secondary)/);
      expect(hue).not.toMatch(/#/);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("uses no hardcoded hex", () => {
    const { container } = render(<Avatar name="Maya Patel" />);
    expect(hexIn(classOf(container, "span"))).toHaveLength(0);
  });
});

describe("Skeleton (cmp-skeleton)", () => {
  it("renders a muted rounded placeholder, static under reduced motion", () => {
    const { container } = render(<Skeleton className="h-4 w-2/3" />);
    const sk = container.querySelector('[aria-hidden="true"][data-testid="skeleton"]');
    expect(sk?.className).toContain("bg-muted");
    expect(sk?.className).toContain("rounded-card");
    expect(sk?.className).toContain("h-4");
    expect(sk?.className).toContain("motion-reduce:animate-none");
    expect(hexIn(sk?.className ?? "")).toHaveLength(0);
  });

  it("supports the 8-up first board load", () => {
    const { container } = render(
      <div>
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>,
    );
    expect(container.querySelectorAll('[data-testid="skeleton"]')).toHaveLength(8);
  });
});

describe("Toaster (cmp-toast)", () => {
  beforeEach(() => dismissToast());

  it("renders nothing until feedback is pushed", () => {
    const { container } = render(<Toaster />);
    expect(container.firstChild).toBeNull();
  });

  it("surfaces success politely and error assertively, via tokens", () => {
    render(<Toaster />);
    act(() => {
      toast.success("Kudos sent");
      toast.error("Reaction could not be saved");
    });
    expect(screen.getByTestId("toaster")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Kudos sent")).toBeInTheDocument();
    expect(document.querySelector('[data-variant="success"]')).toHaveAttribute("role", "status");
    expect(document.querySelector('[data-variant="error"]')).toHaveAttribute("role", "alert");
    expect(classOf(document.body, '[data-variant="success"] span')).toContain("text-success");
    expect(classOf(document.body, '[data-variant="error"] span')).toContain("text-destructive");
  });

  it("keeps styling on tokens only and supports descriptions + dismissal", () => {
    render(<Toaster />);
    act(() => {
      toast.success("Kudos sent", { description: "Maya will see this soon" });
      toast.error("Reaction could not be saved");
      toast.info("Kudos hidden");
    });
    expect(screen.getByText("Maya will see this soon")).toBeInTheDocument();
    const rows = Array.from(document.querySelectorAll("[data-variant]"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(hexIn(row.className)).toHaveLength(0);
    act(() => dismissToast());
    expect(screen.queryByText("Kudos sent")).toBeNull();
  });

  it("exposes sonner-shaped helpers for later action feedback", () => {
    for (const h of ["success", "error", "info", "loading", "dismiss", "message"] as const) {
      expect(typeof toast[h]).toBe("function");
    }
  });
});
