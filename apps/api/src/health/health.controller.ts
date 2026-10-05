import { Controller, Get } from "@nestjs/common";

/**
 * Public liveness probe (T-9).
 *
 * `GET /health` is the one route that must answer **without** a session cookie:
 * it is what the deployment platform polls to decide whether the API container
 * is alive, and a probe carries no credentials. It is therefore mounted with no
 * `@UseGuards(SessionGuard)` - the same public-exemption mechanism
 * `POST /api/v1/auth/login` uses (auth.login is the only other unguarded
 * route). Every kudos / reaction / moderation route keeps the guard.
 *
 * Deliberately dependency-free and constant: a liveness probe must not touch
 * the database (a slow query would flap a healthy container) and must not
 * depend on `PrismaModule`, so it stays answerable whatever the database does.
 * Readiness, if it is ever needed, is a separate endpoint - not this one.
 *
 * Registered directly with `AppModule` (there is no `HealthModule`), so no
 * feature module's files change to expose it.
 */
@Controller("health")
export class HealthController {
  /**
   * `GET /health` - 200 with `{ "status": "ok" }`.
   *
   * No `@HttpCode` is needed: a `@Get` handler defaults to 200.
   */
  @Get()
  health(): { status: "ok" } {
    return { status: "ok" };
  }
}
