import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { KudosController } from "./kudos.controller";
import { KudosService } from "./kudos.service";

/**
 * The kudos board feature (T-6, EP-3 / EP-4).
 *
 * `PrismaModule` is re-imported even though it is `@Global()` so the module
 * states its real dependency explicitly - a reader sees the persistence
 * foundation without hunting through the app module.
 *
 * The session guard is applied on the controller itself (not registered as a
 * global `APP_GUARD`), so this module stays self-contained and can be imported
 * into a test module on its own. The auth module is *not* a dependency: the
 * guard resolves the session straight from the cookie and `PrismaService`.
 */
@Module({
  imports: [PrismaModule],
  controllers: [KudosController],
  providers: [KudosService],
  exports: [KudosService],
})
export class KudosModule {}
