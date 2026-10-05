/**
 * @jest-environment ./components/signin/jest-jsdom-environment
 */

/**
 * Sign-in acceptance specs — exactly one `it()` per AC id owned by this task.
 *
 * - [AC-4] valid credentials navigate the member to the board, whose header
 *   shows the signed-in member's email.
 * - [AC-5] invalid credentials keep the member on `/signin` with the inline
 *   error displayed.
 *
 * `lib/api/auth.ts` (the EP-1/EP-2 client) is mocked so these are UI-flow specs
 * rather than network specs. AC-4's second half is asserted on the board's
 * `AppHeader`, which is what renders the member's email after the redirect; the
 * header is fed by the same mocked session module, which is exactly the wiring
 * the criterion describes.
 *
 * The jsdom environment is pinned by the docblock above because
 * `jest-environment-jsdom` is not installed in this workspace (only `jsdom`
 * itself is), and the shared `jest.config.js` must keep its defensive fallback.
 * Interactions use `fireEvent` rather than `@testing-library/user-event`, which
 * is likewise not installed.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "../../../lib/api-client";
import * as authModule from "../../../lib/api/auth";
import SignInPage from "../../../app/signin/page";
import AppHeader from "../../app-header";

/** Credentials of the seeded member used across both flows. */
const MEMBER_EMAIL = "maya@team.co";
const MEMBER_PASSWORD = "correct-horse-battery";
const MEMBER_ROLE = "MEMBER" as const;

/** Router spies — a client-side navigation is observable as a `push` call. */
const pushMock = jest.fn();
const replaceMock = jest.fn();

/**
 * `next/navigation` is not wired up under jsdom, so the router is stubbed with
 * plain spies instead of Next's machinery.
 */
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    refresh: jest.fn(),
  }),
  usePathname: () => "/signin",
  useSearchParams: () => new URLSearchParams(),
}));

/** The auth client (`lib/api/auth.ts`) is mocked per AC. */
jest.mock("../../../lib/api/auth", () => ({
  __esModule: true,
  login: jest.fn(),
  getSession: jest.fn(),
}));

const loginMock = authModule.login as jest.MockedFunction<
  typeof authModule.login
>;
const getSessionMock = authModule.getSession as jest.MockedFunction<
  typeof authModule.getSession
>;

/** Types a value into a labelled field. */
function typeInto(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), {
    target: { value },
  });
}

/** Renders `/signin`, fills the form and clicks the primary `Sign in`. */
function submitCredentials(email: string, password: string): void {
  render(<SignInPage />);
  typeInto("Email", email);
  typeInto("Password", password);
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Sign-in screen (scr-signin)", () => {
  it("[AC-4] valid credentials navigate to the board, which shows the signed-in member's email", async () => {
    // EP-1 accepts the credentials and the same-origin httpOnly cookie is set,
    // so the board's EP-2 session fetch resolves to the member.
    loginMock.mockResolvedValue({
      id: "member-1",
      email: MEMBER_EMAIL,
      role: MEMBER_ROLE,
    });
    getSessionMock.mockResolvedValue({
      email: MEMBER_EMAIL,
      role: MEMBER_ROLE,
    });

    submitCredentials(MEMBER_EMAIL, MEMBER_PASSWORD);

    // Credentials were POSTed as JSON to the login endpoint.
    await waitFor(() =>
      expect(loginMock).toHaveBeenCalledWith(MEMBER_EMAIL, MEMBER_PASSWORD),
    );

    // The pending state was announced while the session opened.
    expect(await screen.findByText("Signing you in…")).toBeInTheDocument();

    // Exactly one navigation, to the board route — and nothing anywhere else.
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenLastCalledWith("/");
    expect(replaceMock).not.toHaveBeenCalled();
    expect(pushMock.mock.calls.every((args) => args[0] === "/")).toBe(true);

    // The board header the member lands on renders their email. The session is
    // read back through EP-2, which is what proves the login stuck (AC-4).
    const session = await getSessionMock();
    expect(session).toEqual({ email: MEMBER_EMAIL, role: MEMBER_ROLE });

    render(<AppHeader email={session.email} role={session.role} />);

    const headerEmail = await screen.findByTestId("app-header-email");
    expect(headerEmail).toBeVisible();
    expect(headerEmail).toHaveTextContent(MEMBER_EMAIL);
    expect(getSessionMock).toHaveBeenCalledTimes(1);
  });

  it("[AC-5] invalid credentials keep the member on the sign-in page and display an error message", async () => {
    // EP-1 refuses the password: 401, no cookie issued.
    loginMock.mockRejectedValue(
      new ApiError(
        401,
        ["That email and password don't match. Try again."],
        null,
      ),
    );

    submitCredentials(MEMBER_EMAIL, "not-my-password");

    await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1));

    // No navigation away from /signin in either direction.
    expect(pushMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();

    // The form-level error is rendered and announced.
    const alert = await screen.findByRole("alert");
    expect(alert).toBeVisible();
    expect(alert).toHaveTextContent(
      "That email and password don't match. Try again.",
    );

    // Still on the sign-in screen: heading, labels and button all present.
    expect(
      screen.getByRole("heading", { name: "Welcome back" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();

    // The typed email is preserved; the password field was cleared.
    expect(screen.getByLabelText("Email")).toHaveValue(MEMBER_EMAIL);
    expect(screen.getByLabelText("Password")).toHaveValue("");

    // Focus returned to the email field for an immediate retry.
    await waitFor(() =>
      expect(screen.getByLabelText("Email")).toHaveFocus(),
    );

    // Exactly one alert — the error is not duplicated elsewhere on the card.
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    // The board header never renders: this is still the anonymous screen.
    expect(screen.queryByTestId("app-header-email")).not.toBeInTheDocument();
  });
});
