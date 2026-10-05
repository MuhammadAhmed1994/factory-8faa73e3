"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/button";
import Input from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { ApiError } from "@/lib/api-client";
import { createKudos, KUDOS_MESSAGE_MAX_LENGTH } from "@/lib/api/kudos";
import type { Kudos } from "@/lib/api/kudos";
import { cn } from "@/lib/utils";

/**
 * KudosComposer — the "Say thanks" card at the top of the board (cmp-composer).
 *
 * The one client island on the board that writes: the recipient `Input`, the
 * message textarea, the primary "Send kudos" `Button` and the toast all come
 * from the shared primitives, so the composer owns nothing but state.
 *
 * Designed states (surfaced on the card as `data-state`):
 * - `pristine`   nothing typed yet — no errors shown, counter reads `0/280`.
 *                An empty card nobody has touched is pristine, not invalid: it
 *                has nothing to apologise for yet.
 * - `valid`      both fields filled within the cap — submit enabled.
 * - `invalid`    a started draft is empty somewhere or over the cap — the
 *                primary action is disabled and the offending caption is shown.
 * - `submitting` the POST is in flight — the button shows its spinner and stays
 *                disabled so the kudos cannot be double-sent.
 * - `success`    the 201 came back — both fields reset, the counter returns to
 *                `0/280`, "Kudos sent 🎉" fires and the created kudos is handed
 *                to `onCreated` for the board to prepend. Outranks `invalid`
 *                because the reset draft is legitimately empty again.
 *
 * Client validation mirrors the API contract exactly (AC-8 / AC-9 parity), so a
 * submit can never be blocked here that the server would have accepted — and
 * the three client rules below are the only 400s `POST /api/v1/kudos` can
 * produce for this body:
 *
 * | rule                      | client caption                          | API rule |
 * |---------------------------|-----------------------------------------|----------|
 * | recipient empty           | "Who are you thanking?"                 | `@IsNotEmpty` (AC-9) |
 * | message empty             | "Say something nice."                   | `@MinLength(1)` (AC-9) |
 * | message over 280 chars    | "That's over the 280-character limit."  | `@MaxLength(280)` (AC-8) |
 *
 * `maxlength` is deliberately **never** set on the textarea: characters 281+
 * must stay typeable so the over-limit state is reachable and visible, exactly
 * as AC-8's 281-character case exercises it.
 */

/** Message cap shared with the API (constraint C-2 / AC-8). */
export const MESSAGE_MAX_LENGTH = KUDOS_MESSAGE_MAX_LENGTH;

/** "Announce the counter politely once 10 characters remain." */
export const COUNTER_NEAR_LIMIT_REMAINING = 10;

/** Inline captions — the designed copy, identical client- and server-side. */
export const RECIPIENT_REQUIRED_MESSAGE = "Who are you thanking?";
export const MESSAGE_REQUIRED_MESSAGE = "Say something nice.";
export const MESSAGE_OVER_LIMIT_MESSAGE =
  "That's over the 280-character limit.";

/** The composer's five designed states. */
export type KudosComposerState =
  | "pristine"
  | "valid"
  | "invalid"
  | "submitting"
  | "success";

/** What the composer holds — exactly the two fields EP-4 accepts. */
export interface KudosDraft {
  recipient: string;
  message: string;
}

/** Field-level captions keyed by field name. */
export type KudosFieldErrors = Partial<Record<keyof KudosDraft, string>>;

const KUDOS_FIELDS = ["recipient", "message"] as const;

/**
 * Mirrors `CreateKudosDto` on the client.
 *
 * Length is measured on the raw string (as `class-validator`'s `@MaxLength`
 * does, and as the counter displays), while emptiness is measured after
 * trimming — so a whitespace-only message is caught before the round trip
 * instead of after it. Being stricter on emptiness cannot reject a body the
 * API would accept, because such a body is never sent.
 */
export function validateKudosDraft(draft: KudosDraft): KudosFieldErrors {
  const errors: KudosFieldErrors = {};

  if (draft.recipient.trim().length === 0) {
    errors.recipient = RECIPIENT_REQUIRED_MESSAGE;
  }

  if (draft.message.trim().length === 0) {
    errors.message = MESSAGE_REQUIRED_MESSAGE;
  } else if (draft.message.length > MESSAGE_MAX_LENGTH) {
    errors.message = MESSAGE_OVER_LIMIT_MESSAGE;
  }

  return errors;
}

/** Props accepted by {@link KudosComposer}. */
export interface KudosComposerProps {
  /**
   * Receives the created kudos (ADR-7 shape) on every 201. The board prepends
   * it to the top of the list — that is AC-7's "new kudos appears at the top".
   */
  onCreated?: (kudos: Kudos) => void;
  /**
   * The POST came back 401: the session is gone. The composer stays
   * presentation-only and lets the owner route to `/signin` (ADR-1).
   */
  onUnauthenticated?: () => void;
  /** Extra classes for the card. */
  className?: string;
}

/** Shared text-control styling, kept beside the `Input` primitive's tokens. */
const TEXTAREA_BASE_CLASSES = cn(
  "block w-full resize-none rounded-control border border-border bg-muted",
  "px-3 py-2 font-body text-body-m text-foreground",
  "min-h-[86px] transition duration-fast ease-enter",
  "placeholder:text-muted-foreground",
  "focus:border-primary focus-visible:border-primary",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "focus-visible:ring-offset-background",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

const TEXTAREA_INVALID_CLASSES = cn(
  "border-destructive focus:border-destructive focus-visible:border-destructive",
  "focus-visible:ring-destructive",
);

/** Field caption: helper text when quiet, an announced error when not. */
function FieldCaption({
  id,
  children,
  tone = "muted",
}: {
  id: string;
  children: string;
  tone?: "muted" | "error";
}) {
  const isError = tone === "error";
  return (
    <p
      id={id}
      role={isError ? "alert" : undefined}
      data-tone={tone}
      className={cn(
        "type-caption",
        isError ? "font-medium text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

export function KudosComposer({
  onCreated,
  onUnauthenticated,
  className,
}: KudosComposerProps) {
  // `useId` defaults to ids containing `:` / `«»`, which are neither valid HTML
  // ids nor CSS-selector-safe; strip them so the aria-describedby wiring stays
  // resolvable for assistive tech and for CSS.escape-free lookups alike.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const recipientId = `kudos-recipient-${uid}`;
  const messageId = `kudos-message-${uid}`;
  const recipientHintId = `${recipientId}-hint`;
  const recipientErrorId = `${recipientId}-error`;
  const messageHintId = `${messageId}-hint`;
  const messageErrorId = `${messageId}-error`;
  const counterId = `${messageId}-counter`;
  const statusId = `kudos-composer-${uid}-status`;
  const titleId = `kudos-composer-${uid}-title`;

  const [draft, setDraft] = useState<KudosDraft>({ recipient: "", message: "" });
  const [touched, setTouched] = useState({ recipient: false, message: false });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverErrors, setServerErrors] = useState<KudosFieldErrors>({});
  const [sentTo, setSentTo] = useState<string | null>(null);

  const clientErrors = validateKudosDraft(draft);
  const overLimit = draft.message.length > MESSAGE_MAX_LENGTH;
  const remaining = MESSAGE_MAX_LENGTH - draft.message.length;
  const nearLimit = !overLimit && remaining <= COUNTER_NEAR_LIMIT_REMAINING;
  const isValid = Object.keys(clientErrors).length === 0;

  // Over-limit is shown the instant it happens — the counter has already turned
  // destructive, so the caption explaining it must be right there with it.
  // Empty-field captions wait until the field is touched (or a submit was
  // attempted), so the pristine card never scolds before anything is typed.
  const errors: KudosFieldErrors = {};
  if (
    clientErrors.message !== undefined &&
    (overLimit || submitAttempted || touched.message)
  ) {
    errors.message = clientErrors.message;
  }
  if (
    clientErrors.recipient !== undefined &&
    (submitAttempted || touched.recipient)
  ) {
    errors.recipient = clientErrors.recipient;
  }
  // A server 400 lands in the same slots with the same copy (see handleSubmit),
  // so the two origins are indistinguishable in the UI — AC-8/AC-9 parity.
  for (const field of KUDOS_FIELDS) {
    if (errors[field] === undefined && serverErrors[field] !== undefined) {
      errors[field] = serverErrors[field];
    }
  }

  // "Pristine" survives only until a real interaction: typing something,
  // blurring a field, or submitting. Emptiness alone must not end it, because
  // every fresh card starts empty — and so does the just-reset success card.
  const interacted =
    submitAttempted ||
    touched.recipient ||
    touched.message ||
    draft.recipient.length > 0 ||
    draft.message.length > 0;

  const state: KudosComposerState = submitting
    ? "submitting"
    : sentTo !== null
      ? "success"
      : !interacted
        ? "pristine"
        : isValid
          ? "valid"
          : "invalid";

  const disabled = !isValid || submitting;

  function setField(field: keyof KudosDraft, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
    // Anything the member types supersedes a stale server verdict, and ends the
    // success state — the card is being drafted again.
    if (serverErrors[field] !== undefined) {
      setServerErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
    if (sentTo !== null) {
      setSentTo(null);
    }
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setSubmitAttempted(true);

    if (!isValid || submitting) {
      return;
    }

    setSubmitting(true);
    setServerErrors({});

    try {
      // `recipient` is trimmed so a stray leading space cannot 400 an otherwise
      // well-formed post; `message` is sent verbatim because its length is the
      // capped quantity and the counter has already counted every character.
      const created = await createKudos({
        recipient: draft.recipient.trim(),
        message: draft.message,
      });

      // 201 — reset both fields, return the counter to 0/280, celebrate, and
      // hand the card to the board so it lands in the top slot (AC-7).
      setDraft({ recipient: "", message: "" });
      setTouched({ recipient: false, message: false });
      setSubmitAttempted(false);
      setSentTo(created.recipient);
      toast.success("Kudos sent 🎉");
      onCreated?.(created);
    } catch (cause) {
      if (cause instanceof ApiError && cause.isValidation) {
        // Map the 400 onto the very same inline captions: where the client rule
        // already fired, its designed copy is shown (identical either way);
        // anything the client could not foresee keeps the API's own words in
        // the same slot, under the same field.
        const mapped: KudosFieldErrors = { ...clientErrors };
        for (const field of KUDOS_FIELDS) {
          const serverMessage = cause.fields[field];
          if (mapped[field] === undefined && serverMessage !== undefined) {
            mapped[field] = serverMessage;
          }
        }
        setServerErrors(mapped);
        toast.error("That kudos could not be sent.");
        return;
      }

      if (cause instanceof ApiError && cause.isUnauthenticated) {
        onUnauthenticated?.();
        return;
      }

      // Network failure / 5xx — the draft is kept so nothing is lost.
      toast.error("That kudos could not be sent.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      data-component="kudos-composer"
      data-state={state}
      data-over-limit={overLimit ? "true" : undefined}
      className={cn(
        "rounded-card border border-border bg-card shadow-card",
        "px-4 py-5 sm:px-6 sm:py-6",
        className,
      )}
    >
      <h2
        id={titleId}
        className="type-heading-m font-heading mb-4 flex items-center gap-2.5 font-bold"
      >
        <span
          aria-hidden="true"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-pill bg-accent-soft text-primary"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path d="M19.414 14.414C21 12.828 22 11.5 22 9.5a5.5 5.5 0 0 0-9.591-3.676a.6.6 0 0 1-.818.001A5.5 5.5 0 0 0 2 9.5c0 2.3 1.5 4 3 5.5l5.535 5.362a2 2 0 0 0 2.879.052a2.12 2.12 0 0 0-.004-3a2.124 2.124 0 1 0 3-3a2.124 2.124 0 0 0 3.004 0a2 2 0 0 0 0-2.828l-1.881-1.882a2.41 2.41 0 0 0-3.409 0l-1.71 1.71a2 2 0 0 1-2.828 0a2 2 0 0 1 0-2.828l2.823-2.762" />
          </svg>
        </span>
        Say thanks
      </h2>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={recipientId} className="type-body-s font-semibold">
            To
          </label>
          <div className="relative">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
            </svg>
            <Input
              id={recipientId}
              name="recipient"
              type="text"
              placeholder="Priya N."
              autoComplete="off"
              value={draft.recipient}
              invalid={errors.recipient !== undefined}
              aria-describedby={
                errors.recipient !== undefined
                  ? `${recipientHintId} ${recipientErrorId}`
                  : recipientHintId
              }
              className="pl-9"
              disabled={submitting}
              onChange={(event) => setField("recipient", event.target.value)}
              onBlur={() =>
                setTouched((current) => ({ ...current, recipient: true }))
              }
            />
          </div>
          <FieldCaption id={recipientHintId}>
            Who is this kudos for?
          </FieldCaption>
          {errors.recipient !== undefined ? (
            <FieldCaption id={recipientErrorId} tone="error">
              {errors.recipient}
            </FieldCaption>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={messageId} className="type-body-s font-semibold">
            Your thanks
          </label>
          {/*
            No `maxLength`: characters 281+ must stay typeable so the
            over-limit state is reachable, visible and countable (AC-8).
          */}
          <textarea
            id={messageId}
            name="message"
            rows={3}
            placeholder="Shipped the migration on a Friday and nothing caught fire. Legend."
            value={draft.message}
            disabled={submitting}
            aria-invalid={errors.message !== undefined || undefined}
            aria-describedby={
              errors.message !== undefined
                ? `${messageHintId} ${messageErrorId} ${counterId}`
                : `${messageHintId} ${counterId}`
            }
            className={cn(
              TEXTAREA_BASE_CLASSES,
              errors.message !== undefined && TEXTAREA_INVALID_CLASSES,
            )}
            onChange={(event) => setField("message", event.target.value)}
            onBlur={() =>
              setTouched((current) => ({ ...current, message: true }))
            }
          />
          <FieldCaption id={messageHintId}>
            Say thanks in 280 characters or less.
          </FieldCaption>
          {errors.message !== undefined ? (
            <FieldCaption id={messageErrorId} tone="error">
              {errors.message}
            </FieldCaption>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-border pt-4">
          <span
            className="type-caption mr-auto tabular-nums tracking-[0.01em]"
            data-testid="kudos-counter"
          >
            {/*
              Always visible. Announced politely while within the cap (loudest
              at 10 remaining) and assertively, via role=alert, once over it.
            */}
            <span
              id={counterId}
              data-over-limit={overLimit ? "true" : undefined}
              data-near-limit={nearLimit ? "true" : undefined}
              role={overLimit ? "alert" : undefined}
              aria-live={overLimit ? undefined : "polite"}
              className={
                overLimit
                  ? "font-semibold text-destructive"
                  : "text-muted-foreground"
              }
            >
              {draft.message.length}/{MESSAGE_MAX_LENGTH}
            </span>
          </span>

          <Button type="submit" disabled={disabled} loading={submitting}>
            Send kudos
          </Button>
        </div>
      </form>

      {/*
        Success is announced politely too — the toast is the visual beat; this
        keeps the confirmation available to screen readers without a focus grab.
      */}
      <p id={statusId} role="status" className="sr-only">
        {sentTo !== null ? `Kudos sent to ${sentTo}.` : ""}
      </p>
    </section>
  );
}

export default KudosComposer;
