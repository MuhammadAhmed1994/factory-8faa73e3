import { Module } from "@nestjs/common";
import { APP_CONFIG, appConfig } from "./app.config";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health/health.controller";
import { KudosModule } from "./kudos/kudos.module";
import { ModerationModule } from "./moderation/moderation.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ReactionsModule } from "./reactions/reactions.module";

/**
 * Root module of the Team Kudos Board API.
 *
 * ## What it owns
 *
 * Composition only. It imports the four feature modules plus the persistence
 * foundation and registers the two cross-cutting concerns no feature module
 * could own without reaching into another feature's files:
 *
 * * the typed `APP_CONFIG` provider — the single source of configuration,
 *   which every feature module's optional `@Inject(APP_CONFIG)` falls back
 *   away from when this module is absent (e.g. a standalone testing module);
 * * {@link HealthController}, the one truly public route in the API.
 *
 * Everything else — routing, validation, authorisation, persistence — stays in
 * the feature modules, exactly as they were written. This module declares no
 * services and no providers of its own beyond `APP_CONFIG`.
 *
 * ## Why there is no constructor
 *
 * `AppConfig` is a *type*, not a class: TypeScript's `emitDecoratorMetadata`
 * cannot name it, so a `constructor(config: AppConfig)` would ask Nest to
 * inject the typeless `Object` and fail at boot with "can't resolve
 * dependencies of the AppModule". Consumers read the config through the
 * `APP_CONFIG` token (`app.get(APP_CONFIG)` / `getAppConfig(app)`), never
 * through a root-module property.
 *
 * ## Auth is per-route, so composition cannot weaken it
 *
 * There is no `APP_GUARD` here. `SessionGuard` is applied by each feature
 * controller through `@UseGuards(SessionGuard)`, which means importing those
 * modules cannot accidentally publish a guarded route: every kudos, reaction
 * and moderation route keeps its 401-without-a-session-cookie behaviour purely
 * by being the controller it already is (ADR-1). The only routes without the
 * guard are `POST /api/v1/auth/login` (which must precede any session) and
 * `GET /health` (infrastructure liveness) — each public by the same
 * mechanism: they simply do not declare it.
 *
 * ## Route inventory once composed
 *
 * | Method | Path | Guarded |
 * | ------ | ---- | ------- |
 * | POST | `/api/v1/auth/login` | no — issues the session |
 * | GET | `/api/v1/auth/session` | yes |
 * | GET | `/api/v1/kudos` | yes |
 * | POST | `/api/v1/kudos` | yes |
 * | PUT | `/api/v1/kudos/:id/reactions` | yes |
 * | POST | `/api/v1/kudos/:id/hide` | yes (+ LEAD role) |
 * | GET | `/health` | no — liveness probe |
 */
@Module({
  imports: [
    // Persistence foundation. `@Global()`, so importing it once here makes
    // `PrismaService` injectable everywhere; the feature modules also import
    // it explicitly to keep that dependency honest.
    PrismaModule,
    // Feature modules (T-5, T-6, T-7, T-8). Order is irrelevant to Nest's
    // injector; listed in dependency order for readability.
    AuthModule,
    KudosModule,
    ReactionsModule,
    ModerationModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_CONFIG, useFactory: appConfig }],
  exports: [APP_CONFIG],
})
export class AppModule {}
