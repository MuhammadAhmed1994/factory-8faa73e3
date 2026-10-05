import { SetMetadata } from "@nestjs/common";
import type { MemberRole } from "@prisma/client";

/** Metadata key `@Roles()` writes and `RolesGuard` reads. */
export const ROLES_KEY = "roles";

/**
 * Declares which member roles may reach a route (ADR-5: only leads moderate).
 *
 * ```ts
 * @UseGuards(SessionGuard, RolesGuard)
 * @Roles(MemberRole.LEAD)
 * @Post(":id/hide")
 * hide() { ... }
 * ```
 *
 * The decorator only records intent - `RolesGuard` enforces it, so a role check
 * stays a guard concern and never an `if` inside a handler.
 *
 * Omitting `@Roles()` is meaningful: the route then needs only a valid session,
 * and any role (MEMBER or LEAD) may call it.
 */
export const Roles = (...roles: readonly MemberRole[]): MethodDecorator &
  ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
