import { Module } from "@nestjs/common";
import { SessionGuard } from "@/common/guards/session.guard";
import { PrismaModule } from "@/prisma/prisma.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

/**
 * Auth feature module (T-5, ADR-1).
 *
 * Declares its controller and service and imports `PrismaModule` for
 * `PrismaService` (the only persistence access point). `SessionGuard` is
 * declared here as a provider so `@UseGuards(SessionGuard)` resolves it — and
 * its `PrismaService` dependency — through this module's injector; it is also
 * exported so any module importing `AuthModule` can guard its own routes with
 * the same instance.
 *
 * `APP_CONFIG` is intentionally *not* re-provided: `AuthService` and
 * `SessionGuard` both take it optionally and fall back to the same typed
 * `appConfig()` factory from `src/app.config.ts`, which honours the `SESSION_*`
 * environment variables. That keeps this module self-contained whether it is
 * wired into `AppModule` (where the token is provided) or mounted standalone in
 * an e2e testing module.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, SessionGuard],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
