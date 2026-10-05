"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn, FOCUS_RING } from "./cn";

/**
 * Input (`cmp-input`) — the shared text-field control.
 *
 * Four designed states, all token-driven (no hardcoded hex):
 *
 * - `default`  muted `--muted` fill on the warm canvas, `--border` outline.
 * - `focus`    card fill, `--border` outline, always-visible amber focus ring.
 * - `error`    `--destructive` border and caret; sets `aria-invalid="true"`.
 * - `disabled` muted fill, dimmed text, pointer events off.
 *
 * Field captions are the caller's concern and stay wired through standard
 * attributes: pass the same `id` you put on the `<label htmlFor>` and pass the
 * caption's id in `aria-describedby`, so helper text and errors are announced to
 * assistive tech (a11y requirement) without this primitive owning the caption.
 */

/** Props for {@link Input}. */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Renders the error state: destructive border/caret plus `aria-invalid="true"`.
   * The message itself is rendered by the caller and linked via
   * `aria-describedby`.
   */
  readonly error?: boolean;
  /**
   * Id of the element that carries the field's error message, applied as
   * `aria-errormessage` so assistive tech can find the caption the caller
   * rendered and wired through `aria-describedby`.
   */
  readonly errorAnnouncedBy?: string;
}

/**
 * The shared single-line input.
 *
 * Ids are forwarded rather than generated so a screen like the sign-in form can
 * wire `<label htmlFor="email">`, the field and its caption together:
 *
 * ```tsx
 * <label htmlFor="recipient">Recipient</label>
 * <Input id="recipient" error errorAnnouncedBy="recipient-error" aria-describedby="recipient-error" />
 * <p id="recipient-error">Choose a colleague</p>
 * ```
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input(
    { error = false, errorAnnouncedBy, className, ...props },
    ref,
  ) {
    return (
      <input
        ref={ref}
        aria-invalid={error || undefined}
        {...(error && errorAnnouncedBy
          ? { "aria-errormessage": errorAnnouncedBy }
          : {})}
        data-error={error ? "true" : undefined}
        className={cn(
          "h-10 w-full rounded-control border bg-muted px-3 text-body-s font-medium text-foreground",
          "placeholder:text-muted-foreground/70",
          "transition duration-base ease-enter",
          "focus:border-border focus:bg-card",
          FOCUS_RING,
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60",
          error
            ? "border-destructive caret-destructive"
            : "border-border",
          className,
        )}
        {...props}
      />
    );
  },
);

export default Input;
