import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * `@Global()` so feature modules (auth, kudos, reactions) inject
 * `PrismaService` without importing this module themselves. It is registered
 * once, in `AppModule`.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
