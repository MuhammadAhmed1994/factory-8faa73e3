"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import Alert from "@/components/ui/alert";
import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import PasswordInput from "@/components/signin/password-input";
import { ApiError } from "@/lib/api-client";
import { login } from "@/lib/api/auth";
import type { SessionMember } from "@/lib/api/auth";
import { cn } from "@/lib/utils";

/**
 * SignInForm — the sign-in card's interactive half (scr-signin, `r-form`).
 *
 * The only client island on `/signin`: everything else on that route is a
 * Server Component. Designed states, surfaced as `data-state` on the form:
 *
 * - `idle`       fresh card — email autofocused, no errors, nothing sent.
 * - `invalid`    an empty-field submit was blocked; the per-field caption
 *                errors are shown and wired via `aria-describedby`.
 * - `submitting` the POST is in flight — both fields and the eye toggle are
 *                disabled, and the primary button shows its spinner with
 *                "Signing you in…". No navigation yet.
 * - `error`      the API answered 401 (invalid credentials) or could not be
 *                reached at all. Stays right here on `/signin`.
 * - `success`    the 200 came back — the form freezes in its disabled look and
 *                the member is routed to `/` (the board), whose server-rendered
 *                header then shows the signed-in member's email (AC-4).
 *
 * Error copy is the designed microcopy, verbatim:
 *
 * | origin                     | copy                                                           |
 * |----------------------------|----------------------------------------------------------------|
 * | empty email                | "Email is required."                                           |
 * | empty password             | "Password is required."                                        |
 * | 401 invalid credentials    | "That email and password don't match. Try again."              |
 * | unreachable API (status 0) | "Can't reach the server. Check your connection and try again." |
 *
 * On a 401 the email is preserved, the password is cleared, and focus returns
 * to the email field — the member retries from the likeliest mistake with the
 * least retyping (AC-5).
 */

/** Designed copy for the empty-field captions (client-side validation only). */
export const EMAIL_REQUIRED_MESSAGE = "Email is required.";
export const PASSWORD_REQUIRED_MESSAGE = "Password is required.";

/** Designed copy for a 401 from `POST /api/v1/auth/login` (AC-5). */
export const INVALID_CREDENTIALS_MESSAGE =
  "That email and password don't match. Try again.";

/** Designed copy for an unreachable API (network failure / status 0). */
export const UNREACHABLE_API_MESSAGE =
  "Can't reach the server. Check your connection and try again.";

/** Button label while the sign-in request is in flight. */
export const SIGNING_IN_LABEL = "Signing you in…";

/** Button label once the session is open, as the reference screen shows it. */
export const SIGNED_IN_LABEL = "Signed in";

/** The sign-in card's five designed states. */
export type SignInFormState =
  | "idle"
  | "invalid"
  | "submitting"
  | "error"
  | "success";

/** Which inline notice, if any, the reserved status region holds. */
export type SignInNoticeKind =
  | "none"
  | "invalid-credentials"
  | "unreachable";

/**
 * Client-side validation — only the two emptiness rules the screen designs.
 *
 * Deliberately *not* an email-format check: the API is the authority on the
 * credential pair and answers 401 for anything it does not recognise, and a
 * stray-format rule here could block a submit the server would have accepted.
 * Trimming means a whitespace-only email is caught before the round trip.
 */
export function validateSignInFields(input: {
  email: string;
  password: string;
}): Partial<Record<"email" | "password", string>> {
  const errors: Partial<Record<"email" | "password", string>> = {};
  if (input.email.trim().length === 0) {
    errors.email = EMAIL_REQUIRED_MESSAGE;
  }
  if (input.password.length === 0) {
    errors.password = PASSWORD_REQUIRED_MESSAGE;
  }
  return errors;
}

/** Props accepted by {@link SignInForm}. */
export interface SignInFormProps {
  /**
   * Where a successful sign-in routes to. Defaults to `/` (the board), whose
   * server-rendered header shows the signed-in member's email (AC-4).
   */
  redirectTo?: string;
  /** Extra classes for the `<form>` element. */
  className?: string;
}

export function SignInForm({ redirectTo = "/", className }: SignInFormProps) {
  const router = useRouter();

  // `useId` defaults to ids containing `:`, which are not valid in an `id`
  // attribute; strip them so every aria wiring below stays resolvable.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const emailId = `signin-email-${uid}`;
  const passwordId = `signin-password-${uid}`;
  const emailErrorId = `${emailId}-error`;
  const passwordErrorId = `${passwordId}-error`;
  const statusId = `signin-status-${uid}`;

  const emailRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"email" | "password", string>>
  >({});
  const [notice, setNotice] = useState<SignInNoticeKind>("none");
  const [signedInAs, setSignedInAs] = useState<SessionMember | null>(null);

  const state: SignInFormState = submitting
    ? "submitting"
    : signedInAs !== null
      ? "success"
      : notice !== "none"
        ? "error"
        : Object.keys(fieldErrors).length > 0
          ? "invalid"
          : "idle";

  // Focus returns to the email field once invalid credentials land. An effect
  // (rather than a focus call in the submit handler) guarantees it happens
  // *after* the re-render that re-enables the field — focusing a still-disabled
  // input is a no-op in the browser, which would silently drop the requirement.
  useEffect(() => {
    if (notice === "invalid-credentials") {
      emailRef.current?.focus();
    }
  }, [notice]);

  function setFieldValue(field: "email" | "password", value: string): void {
    if (field === "email") {
      setEmail(value);
    } else {
      setPassword(value);
    }
    // Typing supersedes a stale verdict on that field only.
    if (fieldErrors[field] !== undefined) {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
    if (notice !== "none") {
      setNotice("none");
    }
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (submitting || signedInAs !== null) {
      return;
    }

    const errors = validateSignInFields({ email, password });
    if (errors.email !== undefined || errors.password !== undefined) {
      // Submit blocked: the empty field(s) get their caption errors wired via
      // aria-describedby, and the first offender takes focus so the correction
      // starts exactly where it is needed.
      setFieldErrors(errors);
      setNotice("none");
      if (errors.email !== undefined) {
        emailRef.current?.focus();
      }
      return;
    }

    setSubmitting(true);
    setFieldErrors({});
    setNotice("none");

    try {
      const member = await login(email.trim(), password);

      // 200 — freeze the card in its disabled look, then route to the board.
      // The board is a Server Component: it resolves the member from the
      // httpOnly cookie server-side and shows the email in its header (AC-4).
      setSignedInAs(member);
      router.push(redirectTo);
      router.refresh();
      return;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        // Invalid credentials: stay on /signin, keep the email, drop the
        // password, and let the effect above return focus to the email field.
        setNotice("invalid-credentials");
        setPassword("");
        return;
      }

      // Unreachable API, 5xx, anything else the screen files under "network".
      setNotice("unreachable");
      return;
    } finally {
      setSubmitting(false);
    }
  }

  const noticeCopy =
    notice === "invalid-credentials"
      ? INVALID_CREDENTIALS_MESSAGE
      : notice === "unreachable"
        ? UNREACHABLE_API_MESSAGE
        : null;

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      data-component="signin-form"
      data-state={state}
      className={cn("flex flex-col gap-4", className)}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={emailId} className="type-body-s font-semibold">
          Email
        </label>
        <Input
          ref={emailRef}
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          spellCheck={false}
          inputMode="email"
          placeholder="maya@team.co"
          // The screen's own a11y note: the email field is the initial focus.
          autoFocus
          value={email}
          disabled={submitting || signedInAs !== null}
          invalid={fieldErrors.email !== undefined}
          aria-describedby={
            fieldErrors.email !== undefined
              ? `${emailErrorId} ${statusId}`
              : statusId
          }
          onChange={(event) => setFieldValue("email", event.target.value)}
        />
        {fieldErrors.email !== undefined ? (
          <p
            id={emailErrorId}
            role="alert"
            className="type-caption font-medium text-destructive"
          >
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={passwordId} className="type-body-s font-semibold">
          Password
        </label>
        <PasswordInput
          id={passwordId}
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          disabled={submitting || signedInAs !== null}
          invalid={fieldErrors.password !== undefined}
          aria-describedby={
            fieldErrors.password !== undefined
              ? `${passwordErrorId} ${statusId}`
              : statusId
          }
          onChange={(event) => setFieldValue("password", event.target.value)}
        />
        {fieldErrors.password !== undefined ? (
          <p
            id={passwordErrorId}
            role="alert"
            className="type-caption font-medium text-destructive"
          >
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        size="lg"
        className="mt-2 w-full rounded-pill"
        loading={submitting}
        disabled={submitting || signedInAs !== null}
      >
        {submitting
          ? SIGNING_IN_LABEL
          : signedInAs !== null
            ? SIGNED_IN_LABEL
            : "Sign in"}
      </Button>

      {/*
        Reserved inline region: it always occupies its 44px, so the card never
        shifts between the error and success states (the screen's "No layout
        shift between error and success states" requirement).

        Only the inner notice carries a role — an error is `role="alert"` (set
        by the Alert primitive) so it is announced assertively, and the success
        line is `role="status"`. Giving this wrapper a role too would turn one
        message into two alert landmarks.
      */}
      <div
        id={statusId}
        aria-live="polite"
        data-testid="signin-form-status"
        className="flex min-h-[44px] items-start"
      >
        {noticeCopy !== null ? (
          <Alert variant={notice === "unreachable" ? "info" : "error"}>
            {noticeCopy}
          </Alert>
        ) : signedInAs !== null ? (
          // The reference screen's success confirmation: a soft warm box with
          // a success-coloured icon — the session opened, nothing is wrong.
          // Only solid tokens are used: an `/opacity` modifier on a
          // `var()`-backed Tailwind colour degrades to fully opaque.
          <p
            role="status"
            data-testid="signin-success"
            className="type-body-s flex w-full items-start gap-2 rounded-control border border-border bg-accent-soft px-3 py-2.5 text-foreground"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 h-4 w-4 flex-none text-success"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m16 9-5.5 5.5L8 12" />
            </svg>
            <span>
              Signed in as <strong>{signedInAs.email}</strong> — opening your
              board…
            </span>
          </p>
        ) : null}
      </div>
    </form>
  );
}

export default SignInForm;
