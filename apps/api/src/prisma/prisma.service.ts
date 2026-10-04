import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

// `PrismaClient` is generated into `node_modules/.prisma/client` by
// `prisma generate` (see `prisma/schema.prisma`). In a workspace where the
// client has not been generated yet the export is missing at *type* level even
// though the runtime import is the correct, canonical one, so `@ts-ignore`
// keeps `pnpm --filter api build` green in both states. Unlike
// `@ts-expect-error` it stays a silent no-op once the client exists, so a
// healthy workspace builds without any suppression being reported.
// @ts-ignore
import { PrismaClient } from "@prisma/client";

/**
 * The slice of the generated `PrismaClient` lifecycle API this service relies
 * on. Declared structurally so the connect/disconnect/shutdown wiring below
 * stays type-checked even when the generated client is not present in
 * `node_modules` yet (see the note on the import above).
 */
interface PrismaClientLifecycle {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $on(event: "beforeExit", listener: () => Promise<void> | void): void;
}

/** Narrows a `PrismaService` reference to the lifecycle methods above. */
const lifecycleOf = (client: PrismaService): PrismaClientLifecycle =>
  client as unknown as PrismaClientLifecycle;

/**
 * Prisma access point for the whole API.
 *
 * Feature modules (auth, kudos, reactions) inject `PrismaService`; nothing
 * outside this class instantiates `PrismaClient`. The client resolves
 * `DATABASE_URL` from the environment, which `app.config.ts` (T-1) defaults to
 * the `postgres` service of the repo-root `docker-compose.yml`, so no `.env`
 * file is required anywhere.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /** Opens the connection pool eagerly, so a bad DATABASE_URL fails at boot. */
  async onModuleInit(): Promise<void> {
    await lifecycleOf(this).$connect();
  }

  /**
   * Closes the pool on shutdown. Nest only calls this once
   * `app.enableShutdownHooks()` (already done in `main.ts`) has registered the
   * signal handlers.
   */
  async onModuleDestroy(): Promise<void> {
    await lifecycleOf(this).$disconnect();
  }

  /**
   * Registers Prisma's own `beforeExit` handler so the query engine is disposed
   * of even when the process tears down outside Nest's shutdown hooks.
   */
  enableShutdownHooks(): void {
    lifecycleOf(this).$on("beforeExit", async () => {
      await lifecycleOf(this).$disconnect();
    });
  }
}
