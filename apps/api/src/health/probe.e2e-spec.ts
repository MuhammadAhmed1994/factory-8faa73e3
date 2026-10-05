import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_CONFIG } from "../app.config";
import { AppModule } from "../app.module";
import { AuthModule } from "../auth/auth.module";
import { HealthController } from "./health.controller";
import { KudosModule } from "../kudos/kudos.module";
import { ModerationModule } from "../moderation/moderation.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ReactionsModule } from "../reactions/reactions.module";

/**
 * Wiring probe of the composed application (T-9).
 *
 * `health.e2e-spec.ts` proves the wiring *behaves* (`/health` public, every
 * guarded route 401, the global pipe keeps 400). This spec proves the wiring
 * *is* what the task describes by inspecting the composed `AppModule` itself:
 *
 *   * the module graph - `AppModule` imports every feature module, and nothing
 *     about them changed to be mounted;
 *   * the resulting route table - one app serves EP-1..EP-6 plus `/health`.
 *
 * A module that exists but is not imported is dead code from the application's
 * point of view, so asserting the imports list is the difference between "the
 * suites pass because each module is tested on its own" and "the API actually
 * boots all of them as one application" - which is this task's whole point.
 */

/** Every feature module the root module must compose. */
const FEATURE_MODULES = [
  PrismaModule,
  AuthModule,
  KudosModule,
  ReactionsModule,
  ModerationModule,
] as const;

/** One route the composed application must serve. */
const EXPECTED_ROUTES: readonly string[] = [
  "GET /health",
  "POST /api/v1/auth/login",
  "GET /api/v1/auth/session",
  "GET /api/v1/kudos",
  "POST /api/v1/kudos",
  "PUT /api/v1/kudos/:id/reactions",
  "POST /api/v1/kudos/:id/hide",
];

/**
 * The express router's stack, as the adapter registered it.
 *
 * Reached through the public adapter instance rather than re-derived from the
 * module metadata, so it reflects what Nest actually mounted at runtime.
 */
interface RouterStack {
  readonly stack: ReadonlyArray<{
    readonly route?: {
      readonly path: string;
      readonly methods: Readonly<Record<string, boolean>>;
    };
  }>;
}

describe("[T-9] AppModule wiring probe", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("[T-9] imports every feature module and registers the health controller at the root", () => {
    const imports = Reflect.getMetadata("imports", AppModule) as unknown[];
    const controllers = Reflect.getMetadata(
      "controllers",
      AppModule,
    ) as unknown[];

    for (const featureModule of FEATURE_MODULES) {
      expect(imports).toContain(featureModule);
    }

    // The liveness controller is registered with AppModule itself - no feature
    // module's files were edited to expose it.
    expect(controllers).toContain(HealthController);

    // The typed config provider stays published for feature modules to inject.
    const providers = Reflect.getMetadata("providers", AppModule) as Array<{
      provide: unknown;
    }>;
    expect(providers.some((provider) => provider.provide === APP_CONFIG)).toBe(
      true,
    );
  });

  it("[T-9] serves the complete route table: EP-1..EP-6 plus GET /health", () => {
    // Express 4 exposes its router as `_router` on the application instance.
    const instance = app.getHttpAdapter().getInstance() as unknown as {
      _router?: RouterStack;
    };
    expect(instance).toBeDefined();

    const router = instance._router;
    expect(router).toBeDefined();
    expect(Array.isArray(router?.stack)).toBe(true);

    const mounted = new Set<string>();
    for (const layer of router?.stack ?? []) {
      const route = layer?.route;
      if (route === undefined) continue;
      for (const method of Object.keys(route.methods ?? {})) {
        mounted.add(`${method.toUpperCase()} ${route.path}`);
      }
    }

    for (const expected of EXPECTED_ROUTES) {
      expect(mounted.has(expected)).toBe(true);
    }
  });
});
