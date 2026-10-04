import { SetMetadata } from "@nestjs/common";
import { MemberRole } from "@prisma/client";

/**
 * Metadata key under which {@link RolesGuard} reads the allowed roles.
 *
 * Exported so `Reflector.get`/`getAllAndOverride` can reference it without
 * depending on the guard module.
 */
export const ROLES_METADATA_KEY = "roles";

/**
 * Declares the member roles allowed to call a route (ADR-5: the hide action is
 * lead-only).
 *
 * Use together with `@UseGuards(SessionGuard, RolesGuard)`:
 *
 * ```ts
 * @UseGuards(SessionGuard, RolesGuard)
 * @Roles(MemberRole.LEAD)
 * @Post(":id/hide")
 * hide(@Param("id") id: string) { ... }
 * ```
 *
 * A route with **no** `@Roles()` metadata needs only a valid session —
 * {@link RolesGuard} lets it through.
 */
export const Roles = (...roles: MemberRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_METADATA_KEY, roles);
