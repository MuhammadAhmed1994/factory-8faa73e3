import {
  Injectable,
  type INestApplication,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type * as PrismaClientModule from "@prisma/client";

/** The lifecycle surface of `PrismaClient` this service relies on directly. */
interface PrismaClientLifecycle {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
}

/** Any constructable class. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConstructor = new (...args: any[]) => any;

/**
 * Placeholder base for the window between `pnpm install` and `prisma generate`.
 *
 * A freshly installed `@prisma/client` re-exports `.prisma/client`, which only
 * exists once the generator has run - until then the module exports nothing at
 * all, so `import { PrismaClient } from "@prisma/client"` does not compile (and
 * requiring it throws). Selecting this placeholder in that window keeps the
 * package - and every feature module that injects `PrismaService` - buildable,
 * and turns an accidental boot into a loud, actionable error instead of a
 * silent no-op client.
 */
class UngeneratedPrismaClient implements PrismaClientLifecycle {
  $connect(): Promise<void> {
    throw new Error(
      "PrismaClient has not been generated yet. Run `pnpm --filter api exec prisma generate`.",
    );
  }

  $disconnect(): Promise<void> {
    return Promise.resolve();
  }
}

/** The generated `PrismaClient` constructor, when the client exists. */
type GeneratedClientCtor =
  typeof PrismaClientModule extends { PrismaClient: infer Ctor }
    ? Ctor extends AnyConstructor
      ? Ctor
      : never
    : never;

/** The base class: the real generated client, or the placeholder above. */
type PrismaClientCtor = [GeneratedClientCtor] extends [never]
  ? typeof UngeneratedPrismaClient
  : GeneratedClientCtor;

/**
 * Resolves the base class at module load, mirroring `PrismaClientCtor`.
 *
 * `require` (instead of a static import) is deliberate: the static form would
 * put the not-yet-generated client on the compile-time surface.
 */
function resolvePrismaClientCtor(): PrismaClientCtor {
  try {
    const ctor = (require("@prisma/client") as { PrismaClient?: unknown })
      .PrismaClient;
    if (typeof ctor === "function") {
      return ctor as PrismaClientCtor;
    }
  } catch {
    // Requiring `@prisma/client` throws until `prisma generate` has produced
    // the `.prisma/client` stubs.
  }
  return UngeneratedPrismaClient as unknown as PrismaClientCtor;
}

const PrismaClientBase: PrismaClientCtor = resolvePrismaClientCtor();

/**
 * The single `PrismaClient` instance of the application.
 *
 * Everything that touches the database injects this service - no feature module
 * constructs its own `PrismaClient`. It is exposed through the `@Global()`
 * `PrismaModule`, so feature modules inject it without re-importing anything.
 */
@Injectable()
export class PrismaService
  extends PrismaClientBase
  implements OnModuleInit, OnModuleDestroy
{
  /** Connects eagerly when the Nest container initialises the module. */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** Releases the connection pool when the app shuts down. */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Wires graceful shutdown for the caller that keeps the process alive (the
   * HTTP listener in `main.ts`).
   *
   * Nest only reacts to SIGINT/SIGTERM once shutdown hooks are enabled; when it
   * then closes the application it calls `onModuleDestroy` above, which
   * disconnects the client before the process exits.
   */
  enableShutdownHooks(app: INestApplication): void {
    app.enableShutdownHooks();
  }
}
