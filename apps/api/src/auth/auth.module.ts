import { Module } from "@nestjs/common";
import { APP_CONFIG, loadAppConfig } from "../app.config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

/**
 * Auth feature module (ADR-1 / ADR-2).
 *
 * Self-sufficient by design: it publishes its own `APP_CONFIG` provider so it
 * can be imported into a test module on its own (`PrismaModule` is `@Global()`
 * and supplies the database), and the same provider is available to
 * `AuthService` and to `SessionGuard` in the real app, where `AppModule`
 * registers it too - Nest keeps one instance per identical token/provider.
 *
 * `AuthModule` is what `AppModule` imports to expose EP-1/EP-2; the kudos and
 * reactions modules own their own `SessionGuard` wiring.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_CONFIG, useFactory: loadAppConfig }],
  exports: [AuthService],
})
export class AuthModule {}
