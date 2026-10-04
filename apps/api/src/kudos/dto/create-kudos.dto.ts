import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";

import { KUDOS_MESSAGE_MAX_LENGTH } from "@/app.config";

/**
 * Request body of `POST /api/v1/kudos` (EP-4).
 *
 * The route is guarded by the global `ValidationPipe` registered in
 * `src/main.ts`, whose `exceptionFactory` maps every validation failure to a
 * **400** `BadRequestException` — which is exactly what AC-8 (281-char
 * message) and AC-9 (missing recipient / empty message) require.
 *
 * `recipient` is deliberately free-form rather than a UUID: the member roster
 * is seeded and identified by email, and `KudosService` resolves the value to
 * an existing `Member` row (accepting either the member id or the email), so a
 * caller can post with whatever identifier it happens to hold.
 *
 * `message` carries the product cap of 280 characters (constraint C-2), and
 * must be non-empty (AC-9).
 */
export class CreateKudosDto {
  /** Id or email of the seeded member being thanked. */
  @IsString({ message: "recipient must be a string" })
  @IsNotEmpty({ message: "recipient is required" })
  recipient!: string;

  /** Public thank-you note, 1–280 characters (C-2 / AC-8 / AC-9). */
  @IsString({ message: "message must be a string" })
  @MinLength(1, { message: "message must not be empty" })
  @MaxLength(KUDOS_MESSAGE_MAX_LENGTH, {
    message: `message must be at most ${KUDOS_MESSAGE_MAX_LENGTH} characters`,
  })
  message!: string;
}
