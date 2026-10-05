import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ReactionsController } from "./reactions.controller";
import { ReactionsService } from "./reactions.service";

/**
 * The reactions feature (T-7, EP-5): one curated-emoji reaction per member per
 * kudos, submitted as `PUT /api/v1/kudos/:id/reactions` (ADR-4).
 *
 * `PrismaModule` is re-imported even though it is `@Global()` so the module
 * states its real dependency explicitly, matching `KudosModule`.
 *
 * `SessionGuard` is applied on the controller itself (not registered as a
 * global `APP_GUARD`), so this module stays self-contained and can be imported
 * into a test module on its own - the guard resolves the session straight from
 * the cookie and `PrismaService`, so the auth module is not a dependency.
 *
 * `ReactionsModule` deliberately does **not** import `KudosModule`: the
 * reaction response reuses `KudosModule`'s *pure* serializer
 * (`kudos/kudos.serializer.ts`, no providers) rather than its service, so the
 * kudos read and the reaction write stay independently testable.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ReactionsController],
  providers: [ReactionsService],
  exports: [ReactionsService],
})
export class ReactionsModule {}
