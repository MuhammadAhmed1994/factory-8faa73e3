import { IsEmail, IsNotEmpty, IsString, MaxLength } from "class-validator";

/**
 * Request body of `POST /api/v1/auth/login` (EP-1, constraint C-5: sign-in is
 * email + password and nothing else).
 *
 * Shape is the only thing validated here — the credential check itself is a
 * business rule and therefore lives in `AuthService`. With the global
 * `ValidationPipe` (registered in `main.ts`) a body that is not
 * `{ email: <valid email>, password: <non-empty string> }` is rejected with a
 * **400** before the controller runs, instead of reaching the service or
 * producing a 500.
 *
 * Both fields are required strings; `email` must additionally be a valid email
 * address. `MaxLength` bounds exist so an absurd payload fails validation
 * instead of being hashed at login cost.
 */
export class LoginDto {
  /** Sign-in identifier; must be a valid email address. */
  @IsString({ message: "email must be a string" })
  @IsNotEmpty({ message: "email must not be empty" })
  @IsEmail({}, { message: "email must be a valid email address" })
  @MaxLength(320, { message: "email must be at most 320 characters" })
  email!: string;

  /** Plaintext password; only ever compared, never persisted or logged. */
  @IsString({ message: "password must be a string" })
  @IsNotEmpty({ message: "password must not be empty" })
  @MaxLength(256, { message: "password must be at most 256 characters" })
  password!: string;
}
