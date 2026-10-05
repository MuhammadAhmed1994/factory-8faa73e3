import { Module } from "@nestjs/common";

import { SessionGuard } from "@/common/guards/session.guard";
import { PrismaModule } from "@/prisma/prisma.module";

import { ReactionsController } from "./reactions.controller";
import { ReactionsService } from "./reactions.service";

/**
 * Reactions feature module (EP-5, `PUT /api/v1/kudos/:id/reactions`).
 *
 * Mirrors `KudosModule`'s wiring so the two board features compose the same
 * way:
 *
 * * `PrismaModule` is imported explicitly even though it is `@Global()` — the
 *   dependency is real (`ReactionsService` and `SessionGuard` both inject
 *   `PrismaService`) and declaring it keeps the module honest if `@Global()`
 *   is ever dropped.
 * * `SessionGuard` is declared as a provider so `@UseGuards(SessionGuard)` on
 *   the controller resolves it through this module's injector (it needs
 *   constructor injection).
 * * `ReactionsService` is exported for the later `AppModule` composition, and
 *   so a future consumer (e.g. the board serializer) can reuse the emoji
 *   mapping without going through HTTP.
 *
 * The kudos module is *not* imported: this module only shares kudos *code* (the
 * `API_V1_PREFIX` constant and the ADR-7 serialiser), not kudos runtime
 * providers, so there is nothing to inject from it.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ReactionsController],
  providers: [ReactionsService, SessionGuard],
  exports: [ReactionsService],
})
export class ReactionsModule {}
