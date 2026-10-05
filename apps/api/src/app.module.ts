import { Module } from "@nestjs/common";
import { APP_CONFIG, loadAppConfig } from "./app.config";

/**
 * Root module of the kudos API.
 *
 * The typed config from `app.config.ts` is published as a provider so feature
 * modules can `@Inject(APP_CONFIG)` it. Feature modules (prisma, auth, kudos,
 * reactions) are imported here by the tasks that own them.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [{ provide: APP_CONFIG, useFactory: loadAppConfig }],
})
export class AppModule {}
