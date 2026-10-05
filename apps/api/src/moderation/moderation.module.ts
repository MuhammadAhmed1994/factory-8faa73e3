import { Module } from "@nestjs/common";
import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";

/**
 * Moderation feature module (T-8 / EP-6 / ADR-5).
 *
 * `PrismaModule` is `@Global()` and therefore not re-imported here; the
 * persistence dependency is stated through `PrismaService` injection alone.
 * (`KudosModule` re-imports it for readability, but moderation owns no query
 * against another feature's tables - it touches only `Kudos.hiddenAt`.)
 *
 * The guard pair (`SessionGuard`, `RolesGuard`) is applied on the controller
 * itself rather than registered as a global `APP_GUARD`, so this module stays
 * self-contained and can be imported into a test module on its own - exactly
 * what the moderation e2e spec does. `RolesGuard` needs no provider either:
 * `Reflector` is part of the core container.
 */
@Module({
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
