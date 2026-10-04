import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { MemberRole } from "@prisma/client";
import { ROLES_METADATA_KEY } from "@/common/decorators/roles.decorator";
import { type AuthenticatedRequest } from "@/common/guards/session.guard";

/**
 * Role-based authorization on top of {@link SessionGuard} (ADR-5).
 *
 * Register **after** the session guard:
 *
 * ```ts
 * @UseGuards(SessionGuard, RolesGuard)
 * @Roles(MemberRole.LEAD)
 * ```
 *
 * Behaviour:
 * - No `@Roles()` metadata → the route needs only a valid session; allow.
 * - No authenticated member on the request → 401 (SessionGuard did not run).
 * - Member role not in the allowed set → **403**, never 401: the caller is
 *   authenticated, just not allowed.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Route-level metadata wins over controller-level metadata.
    const requiredRoles = this.reflector.getAllAndOverride<MemberRole[]>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRoles === undefined || requiredRoles.length === 0) {
      // No @Roles() declared: a valid session is enough.
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const member = request.member;

    if (member === undefined) {
      // SessionGuard has not authenticated the caller. 401, not 403: the
      // failure is "not authenticated", not "not permitted".
      throw new UnauthorizedException(
        "RolesGuard requires SessionGuard to run first",
      );
    }

    if (!requiredRoles.includes(member.role)) {
      throw new ForbiddenException(
        `Role ${member.role} is not allowed to perform this action`,
      );
    }

    return true;
  }
}
