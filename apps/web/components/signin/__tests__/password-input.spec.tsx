/**
 * @jest-environment ./components/signin/jest-jsdom-environment
 */

/**
 * PasswordInput (`cmp-input-password`) specs — the reveal toggle.
 *
 * Not tied to an acceptance criterion; the sign-in ACs live in
 * `signin.spec.tsx`. This covers the control's own contract, which the task
 * spells out explicitly — a ghost eye-icon toggle that flips the input between
 * `password` and `text` and exposes `aria-pressed` with an `aria-label` of
 * `Show password`.
 *
 * The label is supplied by the harness, matching how `SignInForm` renders the
 * field: `PasswordInput` deliberately forwards ids rather than owning them, so
 * the caller's `<label htmlFor>` stays the single source of the field's name.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { InputHTMLAttributes } from "react";
import PasswordInput from "../password-input";

const PASSWORD_ID = "signin-password";

/** Props `SignInForm` forwards to the password field. */
const BASE_PROPS = {
  id: PASSWORD_ID,
  name: "password",
  autoComplete: "current-password",
  value: "hunter42",
  onChange: jest.fn(),
} as const;

/** Renders the field with its visible label and returns the input. */
function renderField(
  props: Partial<InputHTMLAttributes<HTMLInputElement>> = {},
): HTMLInputElement {
  render(
    <div>
      <label htmlFor={PASSWORD_ID}>Password</label>
      <PasswordInput {...BASE_PROPS} {...props} />
    </div>,
  );
  return screen.getByLabelText("Password");
}

describe("PasswordInput reveal toggle", () => {
  it("masks by default and flips to text and back with aria-pressed and a label", () => {
    const field = renderField();

    // Masked at rest, with the toggle exposed as a labelled, unpressed button.
    expect(field).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    // Reveal: the field becomes readable text and the state is announced.
    fireEvent.click(toggle);
    expect(field).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Hide password" })).toBe(toggle);
    expect(screen.queryByRole("button", { name: "Show password" })).toBeNull();

    // And back to masked.
    fireEvent.click(toggle);
    expect(field).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("disables the toggle together with the field so the two never disagree", () => {
    renderField({ disabled: true });

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toBeDisabled();
    expect(screen.getByLabelText("Password")).toBeDisabled();
  });

  it("is a type=button control, so revealing never submits the sign-in form", () => {
    renderField();

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle.getAttribute("type")).not.toBe("submit");
  });
});
