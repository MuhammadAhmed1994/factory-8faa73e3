import {
  UnauthorizedException,
  createParamDecorator,
  type ExecutionContext,
} from "@nestjs/common";
import type { AuthenticatedMember, RequestWithMember } from "../guards/session.guard";

/**
 * Binds the member `SessionGuard` resolved onto the current request.
 *
 * ```ts
 * @UseGuards(SessionGuard)
 * @Get("session")
 * whoAmI(@CurrentMember() member: AuthenticatedMember) {
 *   return member; // { id, email, role } - already loaded, no extra query
 * }
 * ```
 *
 * The member is attached by the guard, so controllers never re-query the
 * session or the member table. Because the parameter is typed as a non-null
 * `AuthenticatedMember`, the decorator fails loudly with 401 rather than
 * handing a handler an `undefined` it would later crash on.
 */
export const CurrentMember = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedMember => {
    const request = context.switchToHttp().getRequest<RequestWithMember>();
    const member = request.member;

    if (member === undefined) {
      throw new UnauthorizedException(
        "No authenticated member on the request. Is SessionGuard applied?",
      );
    }

    return member;
  },
);
