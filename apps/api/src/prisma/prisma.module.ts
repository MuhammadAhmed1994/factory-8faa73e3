import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * Global Prisma module.
 *
 * `@Global()` means feature modules (auth, kudos, reactions) inject
 * `PrismaService` without importing `PrismaModule` themselves. The module is
 * self-contained on purpose: wiring it into `AppModule`'s `imports` is owned by
 * `src/app.module.ts` (T-1), which is not part of this task's files.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
