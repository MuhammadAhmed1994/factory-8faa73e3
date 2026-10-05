"use client";

/**
 * SignInForm — the interactive half of `scr-signin`.
 *
 * Every designed state is handled:
 *
 * - `pristine`      email field autofocused, both fields labelled, submit armed.
 * - `empty fields`  submit is blocked before any request; `Email is required.`
 *                   / `Password is required.` render as caption errors wired to
 *                   their field through `aria-describedby` + `aria-invalid`.
 * - `loading`       both fields and the reveal toggle are disabled, the primary
 *                   button shows a spinner with `Signing you in…`.
 * - `401`           stays on `/signin` (AC-5), renders the `role="alert"` inline
 *                   error, preserves the email, clears the password and returns
 *                   focus to the email field.
 * - `unreachable`   renders the info alert with a `Try again` control that
 *                   resubmits the form as it stands.
 * - `success`       navigates to `/` so the board header shows the member's
 *                   email (AC-4); the form stays frozen while the board opens.
 *
 * The status region keeps a reserved minimum height so the card never shifts
 * when an error appears.
 *
 * Imports use relative paths rather than the `@/` alias so the file resolves
 * identically under `tsc`, Next.js and Jest, whose `moduleNameMapper` is not
 * editable in this workspace.
 */

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn, FOCUS_RING } from "../ui/cn";
import { ApiError } from "../../lib/api-client";
import { login } from "../../lib/api/auth";
import { PasswordInput } from "./password-input";

/** Where a successful sign-in lands: the board (AC-4). */
const BOARD_PATH = "/";

/** Field captions for the blocked-on-empty submit. */
const EMAIL_REQUIRED_MESSAGE = "Email is required.";
const PASSWORD_REQUIRED_MESSAGE = "Password is required.";

/** Inline error for a 401 from EP-1 (AC-5). */
const INVALID_CREDENTIALS_MESSAGE =
  "That email and password don't match. Try again.";

/** Info alert when EP-1 could not be reached at all. */
const NETWORK_UNAVAILABLE_MESSAGE =
  "Can't reach the server. Check your connection and try again.";

/** Primary button copy while the request is in flight. */
const SIGNING_IN_MESSAGE = "Signing you in…";

/** Stable ids so labels, captions and the status region stay wired together. */
const EMAIL_ID = "signin-email";
const EMAIL_ERROR_ID = "signin-email-error";
const PASSWORD_ID = "signin-password";
const PASSWORD_ERROR_ID = "signin-password-error";
const FORM_STATUS_ID = "signin-form-status";

/** Severity of the inline notice in the reserved status region. */
type FormNoticeKind = "error" | "info";

/** A notice rendered into the reserved status region. */
interface FormNotice {
  readonly kind: FormNoticeKind;
  readonly message: string;
}

/** Per-field caption errors. */
interface FieldErrors {
  readonly email?: string;
  readonly password?: string;
}

/** Decorative severity glyph for the inline alert — the text carries meaning. */
function NoticeIcon({ kind }: { readonly kind: FormNoticeKind }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="mt-0.5 h-4 w-4 shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d={kind === "error" ? "M12 8v4M12 16h.01" : "M12 11v5M12 8h.01"} />
    </svg>
  );
}

/**
 * `aria-describedby` always names the reserved status region, plus the field's
 * caption when one is showing, so the message is announced exactly once.
 */
function describeField(errorId?: string): string {
  return [errorId, FORM_STATUS_ID].filter(Boolean).join(" ");
}

/**
 * The email + password sign-in form (US-1).
 *
 * Client-side by necessity: it owns field state, a pending request and a
 * client-side navigation. The surrounding card, wordmark and footnote stay on
 * the server in `app/signin/page.tsx`.
 */
export function SignInForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // The form is `noValidate`: the browser's own bubbles never race ours.
    event.preventDefault();
    if (submitting) return;

    const trimmedEmail = email.trim();
    const nextFieldErrors: FieldErrors = {};
    if (trimmedEmail === "") nextFieldErrors.email = EMAIL_REQUIRED_MESSAGE;
    if (password === "") nextFieldErrors.password = PASSWORD_REQUIRED_MESSAGE;

    setNotice(null);
    setFieldErrors(nextFieldErrors);

    // Blocked before any request is made (scr-signin · error — empty fields).
    if (nextFieldErrors.email !== undefined) {
      emailRef.current?.focus();
      return;
    }
    if (nextFieldErrors.password !== undefined) {
      passwordRef.current?.focus();
      return;
    }

    setSubmitting(true);
    try {
      // EP-1. Same-origin, so the API's httpOnly session cookie is stored.
      await login(trimmedEmail, password);
      // AC-4: land on the board, whose header shows the member's email.
      router.push(BOARD_PATH);
      // Stay frozen while the board opens — no re-enable flash, no re-submit.
      return;
    } catch (error) {
      setPassword("");

      if (error instanceof ApiError && error.status === 401) {
        // AC-5: unknown email or wrong password.
        setNotice({ kind: "error", message: INVALID_CREDENTIALS_MESSAGE });
      } else {
        // Unreachable API, 5xx, anything else the member can retry.
        setNotice({ kind: "info", message: NETWORK_UNAVAILABLE_MESSAGE });
      }

      emailRef.current?.focus();
    }

    setSubmitting(false);
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-busy={submitting}
      data-testid="signin-form"
    >
      <div className="mt-7 space-y-4">
        <div>
          <label
            htmlFor={EMAIL_ID}
            className="mb-1.5 block text-body-s font-medium text-foreground"
          >
            Email
          </label>

          <Input
            ref={emailRef}
            id={EMAIL_ID}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            spellCheck={false}
            disabled={submitting}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={Boolean(fieldErrors.email)}
            aria-describedby={describeField(
              fieldErrors.email ? EMAIL_ERROR_ID : undefined,
            )}
          />

          {fieldErrors.email ? (
            <p
              id={EMAIL_ERROR_ID}
              className="mt-1.5 text-caption text-destructive"
            >
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor={PASSWORD_ID}
            className="mb-1.5 block text-body-s font-medium text-foreground"
          >
            Password
          </label>

          <PasswordInput
            ref={passwordRef}
            id={PASSWORD_ID}
            name="password"
            autoComplete="current-password"
            disabled={submitting}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={Boolean(fieldErrors.password)}
            aria-describedby={describeField(
              fieldErrors.password ? PASSWORD_ERROR_ID : undefined,
            )}
          />

          {fieldErrors.password ? (
            <p
              id={PASSWORD_ERROR_ID}
              className="mt-1.5 text-caption text-destructive"
            >
              {fieldErrors.password}
            </p>
          ) : null}
        </div>
      </div>

      <Button
        type="submit"
        size="lg"
        loading={submitting}
        // The visible label already reads "Signing you in…", so no second,
        // screen-reader-only copy is layered on top of it.
        loadingText=""
        className="mt-6 h-12 w-full rounded-pill font-heading text-body-m font-bold"
      >
        {submitting ? SIGNING_IN_MESSAGE : "Sign in"}
      </Button>

      {/* Reserved region: an error appears here without shifting the card. */}
      <div id={FORM_STATUS_ID} className="mt-4 min-h-[44px]">
        {notice ? (
          <div data-testid="signin-form-notice">
            <Alert variant={notice.kind} className="w-full items-start">
              <NoticeIcon kind={notice.kind} />
              <span className="min-w-0 flex-1">{notice.message}</span>

              {notice.kind === "info" ? (
                <button
                  type="submit"
                  className={cn(
                    "shrink-0 rounded-pill border border-info/40 px-2.5 py-0.5",
                    "text-caption font-medium text-info",
                    "transition duration-base ease-enter hover:bg-info/10",
                    FOCUS_RING,
                  )}
                >
                  Try again
                </button>
              ) : null}
            </Alert>
          </div>
        ) : null}
      </div>
    </form>
  );
}

export default SignInForm;
