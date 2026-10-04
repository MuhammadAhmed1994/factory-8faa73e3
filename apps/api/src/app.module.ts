import { Module } from "@nestjs/common";
import { APP_CONFIG, appConfig, type AppConfig } from "./app.config";

/**
 * Root module of the Team Kudos Board API.
 *
 * Registers the typed config factory from `app.config.ts` under the `APP_CONFIG`
 * token so every feature module can inject `AppConfig` directly:
 *
 *   constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
 *
 * Feature modules added by later tasks (auth, kudos, reactions, Prisma) are
 * wired into this module's `imports`.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [{ provide: APP_CONFIG, useFactory: appConfig }],
  exports: [APP_CONFIG],
})
export class AppModule {
  constructor(readonly config: AppConfig) {}
}
