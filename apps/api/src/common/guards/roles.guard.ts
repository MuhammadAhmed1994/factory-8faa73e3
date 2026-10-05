import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { MemberRole } from "@prisma/client";
import { ROLES_KEY } from "../decorators/roles.decorator";
import type { RequestWithMember } from "./session.guard";

/**
 * Enforces the roles declared with `@Roles(...)` (ADR-5).
 *
 * Must run *after* `SessionGuard`, which is why the pair is always applied
 * together as `@UseGuards(SessionGuard, RolesGuard)` - guards execute in the
 * order they are listed.
 *
 * Semantics:
 *   * no `@Roles()` metadata  -> the route only needs a valid session, allow.
 *   * metadata present and the member's role is in the set -> allow.
 *   * metadata present and the role is not in the set -> **403 Forbidden**,
 *     because the caller *is* authenticated, just not privileged enough
 *     (AC-18). 401 stays reserved for "not authenticated at all".
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Merge controller-level and method-level declarations rather than letting
    // one shadow the other: a controller-wide `@Roles(LEAD)` plus a
    // method-level `@Roles(MEMBER)` admits both roles instead of silently
    // widening or narrowing the controller's restriction.
    const required = this.reflector.getAllAndMerge<MemberRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required === undefined || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithMember>();
    const member = request.member;

    // SessionGuard has not run (mis-ordered guards) or rejected the request.
    // Reporting 403 here would leak that the route exists to an anonymous
    // caller; the honest answer for an unauthenticated caller is 401.
    if (member === undefined) {
      throw new UnauthorizedException("Authentication required.");
    }

    if (!required.includes(member.role)) {
      throw new ForbiddenException(
        "This action requires a role the signed-in member does not have.",
      );
    }

    return true;
  }
}
