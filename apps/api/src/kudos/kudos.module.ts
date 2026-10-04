import { Module } from "@nestjs/common";

import { RolesGuard } from "@/common/guards/roles.guard";
import { SessionGuard } from "@/common/guards/session.guard";
import { PrismaModule } from "@/prisma/prisma.module";

import { KudosController } from "./kudos.controller";
import { KudosService } from "./kudos.service";

/**
 * Kudos feature module (EP-3 / EP-4).
 *
 * Declares the one controller and one service of the feature. `PrismaModule` is
 * imported explicitly even though it is `@Global()` — the dependency is real
 * (`KudosService` and `SessionGuard` both inject `PrismaService`) and declaring
 * it keeps the module honest if `@Global()` is ever dropped.
 *
 * `SessionGuard` and `RolesGuard` are declared as providers so `@UseGuards(...)`
 * on the controller resolves them through this module's injector (both need
 * constructor injection). The auth module is *not* a dependency: the guard
 * resolves the session directly from the `sessions` table, which is why a test
 * module can authenticate a request simply by inserting a `Session` row.
 */
@Module({
  imports: [PrismaModule],
  controllers: [KudosController],
  providers: [KudosService, SessionGuard, RolesGuard],
  exports: [KudosService],
})
export class KudosModule {}
