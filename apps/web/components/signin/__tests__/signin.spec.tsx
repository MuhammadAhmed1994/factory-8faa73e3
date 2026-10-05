import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import AppHeader from "@/components/app-header";
import SignInForm from "@/components/signin/signin-form";
import { ApiError, type SessionMember } from "@/lib/api-client";
import { login } from "@/lib/api/auth";

/**
 * Sign-in specs for `/signin` (scr-signin, US-1).
 *
 * Per this task's instructions the file holds **exactly one `it()` block per
 * AC id in `ac_ids`**, and no title ever carries two ids:
 *
 * - `[AC-4]` valid credentials → the member is navigated to the board, whose
 *   header shows the signed-in member's email.
 * - `[AC-5]` invalid credentials → the member stays on the sign-in page and an
 *   error message is displayed.
 *
 * `lib/api/auth.ts` is mocked (`login`), as the task prescribes, so these specs
 * pin the *form's* behaviour at the boundary this task owns: which credentials
 * it sends, where it routes on a 200, and what it renders on a 401.
 * `next/navigation` is mocked the same way, because the router only exists
 * inside a real Next.js runtime.
 *
 * Mock-path note: this repo's jest resolver resolves the `@/*` alias for
 * `import` statements but not for `jest.mock()`'s own resolution step —
 * `jest.mock("@/lib/api/auth", …)` fails with "Cannot find module". The mocks
 * therefore use the module's real relative path from this file, which jest
 * resolves to the same module the alias import binds to (asserted in the
 * sibling `signin-contract.spec.tsx`).
 */

/** A seeded member, as `POST /api/v1/auth/login` answers it on 200. */
const MEMBER: SessionMember = { email: "maya@team.co", role: "MEMBER" };

const VALID_EMAIL = "maya@team.co";
const VALID_PASSWORD = "correct-horse-battery";
const WRONG_PASSWORD = "not-the-password";

/* ------------------------------------------------------------------ *
 * next/navigation — the App Router hooks, stood in for jsdom.
 * ------------------------------------------------------------------ */

/** The router `useRouter()` hands back; reachable from the spec via `__router`. */
interface RouterStub {
  push: jest.Mock;
  replace: jest.Mock;
  refresh: jest.Mock;
  back: jest.Mock;
  forward: jest.Mock;
  prefetch: jest.Mock;
}

const router: RouterStub = {
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

/* ------------------------------------------------------------------ *
 * lib/api/auth.ts — mocked per the task's instructions.
 * ------------------------------------------------------------------ */

jest.mock("../../../lib/api/auth", () => ({
  login: jest.fn(),
  getSession: jest.fn(),
}));

/** The mocked `login`, typed for `mockResolvedValue` / `mockRejectedValue`. */
const loginMock = jest.mocked(login);

/** Fills both fields with the given credentials, as the member would. */
function typeCredentials(email: string, password: string): void {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
}

/** Submits the card with Enter — the screen's documented submit gesture. */
function submit(): void {
  fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
}

beforeEach(() => {
  loginMock.mockReset();
  router.push.mockReset();
  router.replace.mockReset();
  router.refresh.mockReset();
});

describe("[AC-4] valid credentials reach the board", () => {
  it("[AC-4] submitting valid credentials navigates the member to the board page, which shows the signed-in member's email", async () => {
    loginMock.mockResolvedValue(MEMBER);

    const view = render(<SignInForm />);

    // The card submits the member's credentials to the auth API.
    typeCredentials(VALID_EMAIL, VALID_PASSWORD);
    submit();

    await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1));
    expect(loginMock).toHaveBeenCalledWith(VALID_EMAIL, VALID_PASSWORD);

    // 200 → routed to '/' (the board), not to any other screen.
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(router.push).toHaveBeenCalledWith("/");
    // No bounce away from the board once the session is open.
    expect(router.replace).not.toHaveBeenCalled();

    // The 200 member is surfaced on the card while the board opens.
    await waitFor(() =>
      expect(view.getByText(new RegExp(MEMBER.email))).toBeInTheDocument(),
    );

    // The board the member lands on is a Server Component that resolves the
    // member from the httpOnly session cookie; its header renders exactly this
    // member through the shared AppHeader, so the email is on screen.
    view.unmount();
    render(<AppHeader member={MEMBER} />);
    expect(screen.getByText(MEMBER.email)).toBeInTheDocument();
  });
});

describe("[AC-5] invalid credentials stay on the sign-in page", () => {
  it("[AC-5] submitting invalid credentials keeps the member on the sign-in page and displays the error message", async () => {
    // The API's single generic 401 for an unknown email or wrong password.
    loginMock.mockRejectedValue(
      new ApiError(401, "That email and password don't match. Try again.", {
        statusCode: 401,
        message: "That email and password don't match. Try again.",
      }),
    );

    render(<SignInForm />);

    typeCredentials(VALID_EMAIL, WRONG_PASSWORD);
    submit();

    await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1));
    expect(loginMock).toHaveBeenCalledWith(VALID_EMAIL, WRONG_PASSWORD);

    // The member is not routed anywhere — they stay on /signin.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "That email and password don't match. Try again.",
      ),
    );
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();

    // The email is preserved so the retry starts one field later; the password
    // is cleared and focus returns to the email field.
    expect(screen.getByLabelText("Email")).toHaveValue(VALID_EMAIL);
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveFocus();

    // The board header never learns about this member.
    expect(
      screen.queryByText(new RegExp(MEMBER.email)),
    ).not.toBeInTheDocument();
  });
});
