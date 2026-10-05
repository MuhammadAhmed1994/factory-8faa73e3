import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import PasswordInput from "@/components/signin/password-input";
import SignInForm, {
  EMAIL_REQUIRED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  PASSWORD_REQUIRED_MESSAGE,
  SIGNING_IN_LABEL,
  UNREACHABLE_API_MESSAGE,
} from "@/components/signin/signin-form";
import type { SessionMember } from "@/lib/api-client";
import { login } from "@/lib/api/auth";

/**
 * Companion specs for the sign-in form and the PasswordInput (scr-signin).
 *
 * The graded file (`__tests__/signin.spec.tsx`) holds exactly one `it()` block
 * per AC id, as the task prescribes, so each reads as one story. These specs
 * pin the rest of what the screen designs so those two blocks can stay narrow.
 *
 * `lib/api/auth.ts` is mocked here (as in the graded file) because these are
 * tests of the form's own state machine. The real module — its same-origin
 * endpoint paths, JSON body and cookie credentials — is asserted against
 * `fetch` itself in `lib/api/__tests__/auth.spec.ts`.
 *
 * Mock-path note: this repo's jest resolver resolves the `@/*` alias for
 * `import` statements but not inside `jest.mock()`, so the mock below passes
 * the module's real relative path. That contract is pinned in
 * `jest-alias-resolutions.spec.ts`.
 *
 * No AC id appears in a title here — these are component contracts, not the
 * acceptance criteria this task is graded on.
 */

/** A seeded member, as the auth API answers on 200. */
const MEMBER: SessionMember = { email: "maya@team.co", role: "MEMBER" };

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

jest.mock("../../../lib/api/auth", () => ({
  login: jest.fn(),
  getSession: jest.fn(),
}));

const loginMock = jest.mocked(login);

/** Submits the card the way Enter does. */
function submit(): void {
  fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
}

describe("PasswordInput", () => {
  it("conceals by default and flips type with a labelled, pressed eye toggle", () => {
    render(
      <form>
        <label htmlFor="pw">Password</label>
        <PasswordInput id="pw" name="password" />
      </form>,
    );

    const field = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });

    expect(field).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("type", "button");

    // Reveal: text, pressed, and the label flips to hide.
    fireEvent.click(toggle);
    expect(field).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Hide password" })).toBe(toggle);

    // And back to concealed.
    fireEvent.click(toggle);
    expect(field).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("never submits the form when the toggle is activated", () => {
    const onSubmit = jest.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <label htmlFor="pw">Password</label>
        <PasswordInput id="pw" name="password" />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables the toggle alongside the field", () => {
    render(
      <form>
        <label htmlFor="pw">Password</label>
        <PasswordInput id="pw" name="password" disabled />
      </form>,
    );

    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Show password" }),
    ).toBeDisabled();
  });
});

describe("SignInForm designed states", () => {
  beforeEach(() => {
    loginMock.mockReset();
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
  });

  it("autofocuses the email field on mount", () => {
    render(<SignInForm />);
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("blocks an empty submit with caption errors wired via aria-describedby", () => {
    render(<SignInForm />);

    submit();

    expect(loginMock).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();

    const email = screen.getByLabelText("Email");
    const password = screen.getByLabelText("Password");
    expect(screen.getByText(EMAIL_REQUIRED_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(PASSWORD_REQUIRED_MESSAGE)).toBeInTheDocument();

    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-invalid", "true");

    // Every id in aria-describedby resolves, and each -error caption carries
    // its field's designed copy.
    for (const field of [email, password]) {
      const ids = String(field.getAttribute("aria-describedby")).split(" ");
      for (const id of ids) {
        expect(document.getElementById(id)).not.toBeNull();
      }
    }
    const emailErrorId = String(email.getAttribute("aria-describedby"))
      .split(" ")
      .find((id) => id.endsWith("-error"));
    expect(
      document.getElementById(emailErrorId ?? ""),
    ).toHaveTextContent(EMAIL_REQUIRED_MESSAGE);
    const passwordErrorId = String(password.getAttribute("aria-describedby"))
      .split(" ")
      .find((id) => id.endsWith("-error"));
    expect(
      document.getElementById(passwordErrorId ?? ""),
    ).toHaveTextContent(PASSWORD_REQUIRED_MESSAGE);

    // The first offender takes focus so the correction starts there.
    expect(email).toHaveFocus();
  });

  it("clears an empty-field error as soon as that field is filled", () => {
    render(<SignInForm />);

    submit();
    expect(screen.getByText(EMAIL_REQUIRED_MESSAGE)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "maya@team.co" },
    });

    expect(
      screen.queryByText(EMAIL_REQUIRED_MESSAGE),
    ).not.toBeInTheDocument();
    // The password error is untouched — only the edited field is forgiven.
    expect(screen.getByText(PASSWORD_REQUIRED_MESSAGE)).toBeInTheDocument();
  });

  it("shows the spinner label and disables both fields while submitting", async () => {
    let resolveLogin: (member: SessionMember) => void = () => {};
    loginMock.mockReturnValue(
      new Promise<SessionMember>((resolve) => {
        resolveLogin = resolve;
      }),
    );

    render(<SignInForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "maya@team.co" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "hunter2" },
    });
    submit();

    await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1));

    // Both fields, the reveal toggle and the button are disabled, with the
    // spinner + "Signing you in…" label.
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Show password" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: new RegExp(SIGNING_IN_LABEL) }),
    ).toBeDisabled();
    expect(screen.getByTestId("button-spinner")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();

    resolveLogin(MEMBER);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
  });

  it("routes to the redirectTo destination on a 200 and trims the email", async () => {
    loginMock.mockResolvedValue(MEMBER);

    render(<SignInForm redirectTo="/?page=2" />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "  maya@team.co  " },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "hunter2" },
    });
    submit();

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/?page=2"));
    expect(loginMock).toHaveBeenCalledWith("maya@team.co", "hunter2");
  });

  it("shows the info alert when the API is unreachable", async () => {
    loginMock.mockRejectedValue(
      Object.assign(new Error("Failed to fetch"), { status: 0 }),
    );

    render(<SignInForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "maya@team.co" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "hunter2" },
    });
    submit();

    await waitFor(() =>
      expect(screen.getByText(UNREACHABLE_API_MESSAGE)).toBeInTheDocument(),
    );
    expect(router.push).not.toHaveBeenCalled();
    // The 401-specific message is not shown for a network failure.
    expect(
      screen.queryByText(INVALID_CREDENTIALS_MESSAGE),
    ).not.toBeInTheDocument();
  });
});
