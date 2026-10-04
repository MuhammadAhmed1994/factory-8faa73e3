import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { type AuthenticatedMember } from "@/common/guards/session.guard";

/**
 * Binds the authenticated member to a handler parameter so controllers never
 * re-query the session:
 *
 * ```ts
 * @UseGuards(SessionGuard)
 * @Post()
 * create(@CurrentMember() member: AuthenticatedMember) { ... }
 * ```
 *
 * The value is attached to the request by `SessionGuard`, so this decorator
 * must be used on a route guarded by it; without the guard Nest resolves the
 * parameter to `undefined`, and the guard — not the handler — is what turns
 * that into a 401.
 */
export const CurrentMember = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedMember | undefined =>
    context.switchToHttp().getRequest<{ member?: AuthenticatedMember }>().member,
);
