import { Module } from "@nestjs/common";

import { RolesGuard } from "@/common/guards/roles.guard";
import { SessionGuard } from "@/common/guards/session.guard";
import { PrismaModule } from "@/prisma/prisma.module";

import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";

/**
 * Moderation feature module (EP-6, ADR-5).
 *
 * Declares the one controller and one service of the feature. `PrismaModule` is
 * imported explicitly even though it is `@Global()` — the dependency is real
 * (`ModerationService` and `SessionGuard` both inject `PrismaService`) and
 * declaring it keeps the module honest if `@Global()` is ever dropped. This
 * mirrors `KudosModule` / `AuthModule` exactly.
 *
 * `SessionGuard` and `RolesGuard` are declared as providers so the
 * `@UseGuards(SessionGuard, RolesGuard)` on `ModerationController` resolves
 * them through this module's injector (both need constructor injection:
 * `PrismaService` and `Reflector` respectively). The kudos feature module is
 * *not* imported — the only thing moderation takes from it is the
 * `API_V1_PREFIX` string constant, a compile-time value with no runtime
 * dependency, and the board's read path that excludes hidden rows already
 * lives in `KudosService` (`where: { hiddenAt: null }`).
 */
@Module({
  imports: [PrismaModule],
  controllers: [ModerationController],
  providers: [ModerationService, SessionGuard, RolesGuard],
  exports: [ModerationService],
})
export class ModerationModule {}
