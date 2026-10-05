import { Module } from "@nestjs/common";
import { APP_CONFIG, loadAppConfig } from "./app.config";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health/health.controller";
import { KudosModule } from "./kudos/kudos.module";
import { ModerationModule } from "./moderation/moderation.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ReactionsModule } from "./reactions/reactions.module";

/**
 * Root module of the kudos API (T-9).
 *
 * The typed config from `app.config.ts` is published as a provider so feature
 * modules can `@Inject(APP_CONFIG)` it.
 *
 * This module only *composes*: every feature module owns its own controllers,
 * services and guard wiring, and each applies `SessionGuard` on its own
 * controller - so importing them here preserves exactly the protection each
 * one declared on its own (401 without a session cookie on every kudos,
 * reaction and moderation route; `AuthController.login` stays public). Nothing
 * about a feature module had to change to be mounted here.
 *
 * `HealthController` is the one route mounted at the root instead of inside a
 * feature module: it is infrastructure, shared by no feature, and must stay
 * outside the session guard so a credential-less liveness probe can reach it.
 */
@Module({
  imports: [
    // `@Global()` persistence: publishes `PrismaService` to every module below.
    PrismaModule,
    // EP-1 / EP-2 - session issue + who-am-i (ADR-1).
    AuthModule,
    // EP-3 / EP-4 - the board read and the post (ADR-6 / ADR-7).
    KudosModule,
    // EP-5 - one upsert-replace reaction per member per kudos (ADR-4).
    ReactionsModule,
    // EP-6 - the lead-only soft hide (ADR-5).
    ModerationModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_CONFIG, useFactory: loadAppConfig }],
})
export class AppModule {}
