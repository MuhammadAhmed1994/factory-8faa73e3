import { Controller, Get } from "@nestjs/common";

/**
 * Route path of the liveness probe.
 *
 * Deliberately *unversioned* (`/health`, not `/api/v1/health`): a deployment
 * platform's liveness/readiness probe is infrastructure traffic, not product
 * API traffic, and versioning it would couple every redeploy to the product's
 * version prefix.
 */
export const HEALTH_PATH = "health";

/** Body of a successful `GET /health`. */
export interface HealthResponse {
  readonly status: "ok";
}

/**
 * Public liveness probe (T-9).
 *
 * `GET /health` → **200** `{"status":"ok"}`.
 *
 * ## Why this controller has no guard
 *
 * The API has **no global guard**: `SessionGuard` is applied per route/controller
 * via `@UseGuards(SessionGuard)` (see `KudosController`, `ReactionsController`,
 * `ModerationController` and `AuthController.session`). A route is therefore
 * public exactly by *omitting* that decorator — which is the same
 * public-exemption mechanism `POST /api/v1/auth/login` relies on: it must be
 * reachable before any session can exist.
 *
 * A liveness probe must answer the same way, so this controller omits the guard
 * too. An unauthenticated `GET /health` (no `Cookie` header at all) reaches the
 * handler and returns 200, which is what the deployment platform polls.
 *
 * ## Why it is not a feature module
 *
 * `HealthController` has no providers, no persistence access and nothing to
 * export, so there is no `HealthModule` to declare — it is registered directly
 * on `AppModule`'s `controllers`, which owns the composition. No feature
 * module's files are touched.
 *
 * ## Staying thin
 *
 * The handler returns a constant; there is no business logic to delegate to a
 * service. Process-level liveness (the fact that the event loop is serving
 * requests at all) *is* the signal — this controller deliberately does not
 * probe Postgres, because a slow-but-alive database must not get an otherwise
 * healthy API process killed by its liveness probe.
 */
@Controller(HEALTH_PATH)
export class HealthController {
  /**
   * `GET /health` — unauthenticated liveness answer.
   *
   * `@HttpCode` is omitted because **200** is already Nest's default for
   * `@Get`, and the response is a plain JSON object rather than a DTO: there is
   * no request input to validate.
   */
  @Get()
  check(): HealthResponse {
    return { status: "ok" };
  }
}
