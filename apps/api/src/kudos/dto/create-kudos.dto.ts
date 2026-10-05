import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/**
 * Input DTOs of the kudos feature (EP-3 / EP-4).
 *
 * Validation lives here so a bad payload is answered with **400** by the
 * `ValidationPipe` (see `main.ts`, mirrored by the e2e spec) instead of being
 * silently dropped or surfacing as a 500 from a database error (AC-8 / AC-9).
 */

/** Hard cap on a kudos message (C-2). */
export const KUDOS_MAX_MESSAGE_LENGTH = 280;

/** Board page size (C-3 / ADR-6): fixed at 20, not client configurable. */
export const KUDOS_PAGE_SIZE = 20;

/**
 * Body of `POST /api/v1/kudos`.
 *
 * `recipient` is deliberately accepted as *either* a member's email or a
 * member's id: both identify a seeded colleague, and the service resolves the
 * value to an existing `Member` row (returning 400 when it does not). Forcing
 * an `@IsEmail()` here would reject the id form for no product reason - the
 * board composer picks a colleague either way.
 */
export class CreateKudosDto {
  /** The thanked colleague: her/his email or member id. */
  @IsString()
  @IsNotEmpty()
  readonly recipient!: string;

  /** The public thank-you note: 1-280 characters (C-2, AC-8, AC-9). */
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(KUDOS_MAX_MESSAGE_LENGTH)
  readonly message!: string;
}

/**
 * Query of `GET /api/v1/kudos` (ADR-6).
 *
 * `page` defaults to 1 when absent and must be a positive integer when present;
 * `hidden` opts into the lead-only review variant of the same endpoint.
 */
export class ListKudosQueryDto {
  /** 1-based page number; the endpoint always returns at most 20 kudos. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page?: number;

  /**
   * `"true"` returns the soft-hidden review list instead of the board (lead
   * only, ADR-5). Kept as a closed string set rather than a boolean so the
   * query string is validated explicitly and never coerced by surprise.
   */
  @IsOptional()
  @IsIn(["true", "false"])
  readonly hidden?: string;
}
