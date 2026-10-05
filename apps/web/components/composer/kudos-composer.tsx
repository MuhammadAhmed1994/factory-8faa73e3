"use client";

import { useId, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { cn, FOCUS_RING } from "../../components/ui/cn";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toast } from "../../components/ui/toaster";
import { isApiError, type ApiError } from "../../lib/api-client";
import {
  createKudos,
  KUDOS_MESSAGE_LIMIT,
  type Kudos,
} from "../../lib/api/kudos";

/**
 * KudosComposer (`cmp-composer`) — the "Say thanks" card at the top of the board.
 *
 * A Client Component because it owns controlled form state and fires the create
 * request; everything around it on the board stays on the server (see the
 * architecture rule: only the composer, reaction picker, live poll and hide
 * control are client islands).
 *
 * Designed states, exposed on the section as `data-state`:
 *
 * - `pristine`    nothing typed yet — counter reads `0/280`, submit disabled.
 * - `valid`       recipient + a 1–280 char message — submit enabled.
 * - `invalid`     a field caption is showing (AC-8/AC-9 parity).
 * - `submitting`  request in flight — submit disabled, spinner shown.
 * - `success`     just sent — fields reset, counter back to `0/280` (AC-7).
 *
 * Client validation mirrors the API contract exactly: `recipient` and `message`
 * are required and the message may not exceed 280 characters. The textarea
 * deliberately carries **no `maxLength`** so the 281+ state stays typeable and
 * can be shown as the over-limit error, mirroring AC-8's 281-character case.
 *
 * Navigation is deliberately *not* owned here. A 401 is reported through
 * {@link KudosComposerProps.onUnauthorized} so the board — which already owns
 * the App Router context for the live poll — performs the redirect. That keeps
 * this island free of a router dependency and renderable in isolation.
 */

/** Caption for an empty recipient — mirrors the API's "recipient should not be empty" (AC-9). */
export const RECIPIENT_EMPTY_ERROR = "Who are you thanking?";

/** Caption for an empty message — mirrors the API's "message should not be empty" (AC-9). */
export const MESSAGE_EMPTY_ERROR = "Say something nice.";

/** Caption for a message past the cap — mirrors the API's `@MaxLength(280)` (AC-8). */
export const MESSAGE_TOO_LONG_ERROR = "That's over the 280-character limit.";

/** Success toast (AC-7) — action feedback only, never a notification. */
export const KUDOS_SENT_TOAST = "Kudos sent \ud83c\udf89";

/** Fallback notice when the API fails for a reason other than validation. */
export const KUDOS_SEND_FAILED_ERROR = "Couldn't send that kudos.";

/** The composer's helper line, from the board screen's microcopy. */
export const MESSAGE_HELPER = "Say thanks in 280 characters or less.";

/** Inline captions for the two fields, keyed by field. */
export interface ComposerFieldErrors {
  readonly recipient: string | null;
  readonly message: string | null;
}

/** No captions showing. */
const NO_ERRORS: ComposerFieldErrors = { recipient: null, message: null };

/** Fields the member has interacted with — a caption appears once a field is touched. */
interface TouchedFields {
  recipient: boolean;
  message: boolean;
}

const UNTOUCHED: TouchedFields = { recipient: false, message: false };

/**
 * Client-side validation, kept aligned with the API's `CreateKudosDto`
 * (AC-8 / AC-9 parity): a field is invalid only when it is empty, or when the
 * message exceeds 280 characters. Whitespace is not collapsed on purpose — the
 * server does not trim either.
 */
export function validateComposerFields(
  recipient: string,
  message: string,
): ComposerFieldErrors {
  return {
    recipient: recipient.length === 0 ? RECIPIENT_EMPTY_ERROR : null,
    message:
      message.length === 0
        ? MESSAGE_EMPTY_ERROR
        : message.length > KUDOS_MESSAGE_LIMIT
          ? MESSAGE_TOO_LONG_ERROR
          : null,
  };
}

/** Hints that a server validation line is about the message's length. */
const OVER_LIMIT_HINT = /280|too long|longer|length|character/;

/**
 * Maps a server `400` onto the same inline captions the client already shows
 * (implementation rule: server 400 responses render as inline field errors), so
 * a member sees identical copy whether the browser or the API caught it.
 *
 * Returns `null` when the messages name neither field, in which case the caller
 * falls back to a form-level notice rather than guessing.
 */
function fieldErrorsFromApiError(error: ApiError): ComposerFieldErrors | null {
  const joined = ` ${error.messages.join(" ")} `.toLowerCase();
  const namesRecipient = joined.includes("recipient");
  const namesMessage = joined.includes("message");

  if (!namesRecipient && !namesMessage) return null;

  return {
    recipient: namesRecipient ? RECIPIENT_EMPTY_ERROR : null,
    message: OVER_LIMIT_HINT.test(joined)
      ? MESSAGE_TOO_LONG_ERROR
      : namesMessage
        ? MESSAGE_EMPTY_ERROR
        : null,
  };
}

/** Props for {@link KudosComposer}. */
export interface KudosComposerProps {
  /**
   * Called with the created kudos (ADR-7 shape) after a `201`. The board task
   * prepends it to the top of the list — the composer does not refetch (AC-7).
   */
  readonly onCreated?: (kudos: Kudos) => void;
  /**
   * Called when the API answers 401 — the session is gone. The board, which
   * owns the router, sends the member to `/signin` (AC-3).
   */
  readonly onUnauthorized?: () => void;
  /** Extra class names for the card. */
  readonly className?: string;
}

/** Decorative `at-sign` glyph inside the recipient field (lucide path, inline). */
function AtSignIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

/** Decorative `send` glyph on the primary action (lucide path, inline). */
function SendIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11zm7.318-19.539l-10.94 10.939" />
    </svg>
  );
}

/** Decorative `heart-handshake` glyph beside the card title (lucide path, inline). */
function HeartHandshakeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M19.414 14.414C21 12.828 22 11.5 22 9.5a5.5 5.5 0 0 0-9.591-3.676a.6.6 0 0 1-.818.001A5.5 5.5 0 0 0 2 9.5c0 2.3 1.5 4 3 5.5l5.535 5.362a2 2 0 0 0 2.879.052a2.12 2.12 0 0 0-.004-3a2.124 2.124 0 1 0 3-3a2.124 2.124 0 0 0 3.004 0a2 2 0 0 0 0-2.828l-1.881-1.882a2.41 2.41 0 0 0-3.409 0l-1.71 1.71a2 2 0 0 1-2.828 0a2 2 0 0 1 0-2.828l2.823-2.762" />
    </svg>
  );
}

/**
 * The composer.
 *
 * Submit is disabled while the payload is invalid or the request is in flight,
 * so the member can never double-post. Captions appear per field only once that
 * field has been touched (or a submit attempt / server `400` has confirmed the
 * problem), which keeps the pristine state clean.
 */
export function KudosComposer({
  onCreated,
  onUnauthorized,
  className,
}: KudosComposerProps) {
  const uid = useId();

  const recipientId = `${uid}recipient`;
  const recipientErrorId = `${uid}recipient-error`;
  const messageId = `${uid}message`;
  const messageHelperId = `${uid}message-helper`;
  const messageErrorId = `${uid}message-error`;
  const counterId = `${uid}counter`;
  const titleId = `${uid}title`;

  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [touched, setTouched] = useState<TouchedFields>(UNTOUCHED);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] =
    useState<ComposerFieldErrors>(NO_ERRORS);
  const [formError, setFormError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);

  const clientErrors = useMemo(
    () => validateComposerFields(recipient, message),
    [recipient, message],
  );

  const messageLength = message.length;
  const remaining = KUDOS_MESSAGE_LIMIT - messageLength;
  const overLimit = messageLength > KUDOS_MESSAGE_LIMIT;

  /** A caption shows once its field was left, a submit was attempted, or the API flagged it. */
  const showRecipientCaption =
    touched.recipient || submitAttempted || serverErrors.recipient !== null;
  const showMessageCaption =
    touched.message || submitAttempted || serverErrors.message !== null;

  const recipientError = serverErrors.recipient
    ?? (showRecipientCaption ? clientErrors.recipient : null);
  const messageError = serverErrors.message
    ?? (showMessageCaption ? clientErrors.message : null);

  const canSubmit =
    clientErrors.recipient === null &&
    clientErrors.message === null &&
    !overLimit;

  const composerState = submitting
    ? "submitting"
    : recipientError !== null || messageError !== null || formError !== null
      ? "invalid"
      : justSent
        ? "success"
        : canSubmit
          ? "valid"
          : "pristine";

  function handleRecipientChange(value: string): void {
    setRecipient(value);
    setJustSent(false);
    if (serverErrors.recipient !== null || formError !== null) {
      setServerErrors((previous) => ({ ...previous, recipient: null }));
      setFormError(null);
    }
  }

  function handleMessageChange(value: string): void {
    setMessage(value);
    setJustSent(false);
    if (serverErrors.message !== null || formError !== null) {
      setServerErrors((previous) => ({ ...previous, message: null }));
      setFormError(null);
    }
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    setSubmitAttempted(true);
    setFormError(null);
    setServerErrors(NO_ERRORS);

    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const created = await createKudos({
        recipient: recipient.trim(),
        message,
      });

      onCreated?.(created);
      setRecipient("");
      setMessage("");
      setTouched(UNTOUCHED);
      setSubmitAttempted(false);
      setServerErrors(NO_ERRORS);
      setJustSent(true);
      toast.success(KUDOS_SENT_TOAST);
    } catch (error: unknown) {
      if (isApiError(error)) {
        // Session gone — the board owns the redirect to /signin (AC-3).
        if (error.isUnauthorized) {
          onUnauthorized?.();
          return;
        }
        // Validation failure: render the same inline captions (AC-8 / AC-9).
        if (error.isValidationFailure) {
          const mapped = fieldErrorsFromApiError(error);
          if (mapped) {
            setServerErrors(mapped);
            return;
          }
        }
      }
      setFormError(KUDOS_SEND_FAILED_ERROR);
      toast.error(KUDOS_SEND_FAILED_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      data-state={composerState}
      data-testid="kudos-composer"
      className={cn(
        "rounded-card border border-border bg-card p-4 shadow-card sm:p-6",
        className,
      )}
    >
      <h2
        id={titleId}
        className="flex items-center gap-2.5 font-heading text-heading-m text-foreground"
      >
        <span
          aria-hidden="true"
          className="grid h-[30px] w-[30px] flex-none place-items-center rounded-pill bg-accent-soft text-primary"
        >
          <HeartHandshakeIcon />
        </span>
        Say thanks
      </h2>

      <form
        noValidate
        onSubmit={handleSubmit}
        className="mt-4 flex flex-col gap-4"
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <label
            htmlFor={recipientId}
            className="text-body-s font-semibold text-foreground"
          >
            To
          </label>
          <div className="relative">
            <AtSignIcon />
            <Input
              id={recipientId}
              name="recipient"
              type="text"
              autoComplete="off"
              placeholder="Priya N."
              value={recipient}
              onChange={(event) => handleRecipientChange(event.target.value)}
              onBlur={() =>
                setTouched((previous) => ({ ...previous, recipient: true }))
              }
              disabled={submitting}
              error={recipientError !== null}
              errorAnnouncedBy={
                recipientError !== null ? recipientErrorId : undefined
              }
              aria-describedby={
                recipientError !== null ? recipientErrorId : undefined
              }
              className="pl-9"
            />
          </div>
          {recipientError !== null ? (
            <p id={recipientErrorId} className="text-caption text-destructive">
              {recipientError}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label
            htmlFor={messageId}
            className="text-body-s font-semibold text-foreground"
          >
            Your thanks
          </label>
          <textarea
            id={messageId}
            name="message"
            rows={3}
            // No maxLength on purpose: the 281+ state must stay typeable (AC-8).
            placeholder="Shipped the migration on a Friday and nothing caught fire. Legend."
            value={message}
            onChange={(event) => handleMessageChange(event.target.value)}
            onBlur={() =>
              setTouched((previous) => ({ ...previous, message: true }))
            }
            disabled={submitting}
            aria-invalid={messageError !== null || undefined}
            aria-describedby={`${messageHelperId} ${counterId}${
              messageError !== null ? ` ${messageErrorId}` : ""
            }`}
            className={cn(
              "block w-full resize-none rounded-control border bg-muted px-3.5 py-2.5",
              "min-h-[86px] text-body-m text-foreground placeholder:text-muted-foreground/70",
              "transition duration-base ease-enter focus:border-border focus:bg-card",
              FOCUS_RING,
              "disabled:pointer-events-none disabled:opacity-60",
              messageError !== null
                ? "border-destructive caret-destructive"
                : "border-border",
            )}
          />
          <p id={messageHelperId} className="text-caption text-muted-foreground">
            {MESSAGE_HELPER}
          </p>
          {messageError !== null ? (
            <p id={messageErrorId} className="text-caption text-destructive">
              {messageError}
            </p>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-4">
          {/* Polite while typing (announced at 10 remaining); assertive when over the cap. */}
          <span
            id={counterId}
            data-over-limit={overLimit ? "true" : undefined}
            role={overLimit ? "alert" : undefined}
            aria-live={overLimit ? undefined : "polite"}
            aria-atomic="true"
            data-testid="kudos-composer-counter"
            className={cn(
              "text-caption font-medium tabular-nums",
              overLimit ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {messageLength}/{KUDOS_MESSAGE_LIMIT}
            {remaining <= 10 && !overLimit && remaining >= 0
              ? ` — ${remaining} left`
              : ""}
          </span>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="ml-auto"
            loading={submitting}
            loadingText="Sending kudos"
            disabled={!canSubmit || submitting}
          >
            Send kudos
            <SendIcon />
          </Button>
        </div>

        {formError !== null ? (
          <p role="alert" className="text-caption text-destructive">
            {formError}
          </p>
        ) : null}
      </form>
    </section>
  );
}

export default KudosComposer;
