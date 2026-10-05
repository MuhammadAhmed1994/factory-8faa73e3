import { IsEmail, IsNotEmpty, IsString } from "class-validator";

/**
 * Body of `POST /api/v1/auth/login` (EP-1 / ADR-1 / C-5).
 *
 * Both fields are required strings and `email` must be a valid address; a
 * malformed body is rejected by the `ValidationPipe` with **400** (see
 * `main.ts` / the e2e spec, which mount the same pipe), never silently coerced
 * and never a 500.
 *
 * `password` is the plaintext credential: it exists only for the lifetime of
 * this request object, is never logged, never persisted and never returned
 * (ADR-2). Only `verifyPassword` ever touches it.
 */
export class LoginDto {
  /** Sign-in identifier of a seeded member (ADR-2: no self-signup). */
  @IsString({ message: "email must be a string" })
  @IsEmail({}, { message: "email must be a valid email address" })
  @IsNotEmpty({ message: "email must not be empty" })
  email!: string;

  /** Plaintext password of the seeded member. */
  @IsString({ message: "password must be a string" })
  @IsNotEmpty({ message: "password must not be empty" })
  password!: string;
}
