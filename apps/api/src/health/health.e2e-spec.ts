import {
  HttpStatus,
  ValidationPipe,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";

/**
 * Full-wiring e2e spec (T-9).
 *
 * Boots **the whole `AppModule`** - PrismaModule, AuthModule, KudosModule,
 * ReactionsModule, ModerationModule and the public `HealthController` - as one
 * Nest application, i.e. the same import graph `main.ts` boots, and registers
 * the same global `ValidationPipe` `main.ts` registers (with
 * `errorHttpStatusCode: 400`). What these blocks pin is therefore the wiring,
 * not any single feature's behaviour - the per-feature suites already do that:
 *
 *   * `GET /health` answers 200 `{ "status": "ok" }` with **no** session cookie
 *     (the public-exemption `POST /auth/login` also uses), and sets no cookie.
 *   * importing the feature modules preserves their own guard wiring: every
 *     kudos / reaction / moderation route still answers **401** for an
 *     anonymous caller (ADR-1 / the NFR), and no `Set-Cookie` is written.
 *   * the global pipe keeps **400** - not a 500, not a silent drop - as its
 *     error status, observed here through the public login route so the guard
 *     cannot short-circuit it.
 *
 * Only unauthenticated requests are made, so no fixture rows are written and
 * the spec needs the schema only insofar as `PrismaService` connects at init -
 * which the other suites' database already satisfies.
 */

describe("[T-9] AppModule boots every feature module plus a public /health", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // The same pipe `main.ts` registers globally, so this boot behaves exactly
    // like the deployed process.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    // Closes the HTTP server and disconnects `PrismaService`.
    await app.close();
  });

  it("[T-9] GET /health answers 200 {\"status\":\"ok\"} for an unauthenticated caller", async () => {
    const response = await request(app.getHttpServer()).get("/health");

    expect(response.status).toBe(HttpStatus.OK);
    // The liveness payload: a JSON body with the ok status.
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body).toEqual({ status: "ok" });

    // The probe is credential-less and must not hand out a session.
    expect(response.headers["set-cookie"]).toBeUndefined();

    // A bogus cookie on a public route is ignored rather than rejected - the
    // route is exempt from the guard, exactly like POST /auth/login.
    const withJunkCookie = await request(app.getHttpServer())
      .get("/health")
      .set("Cookie", "kudos_session=not-a-real-session");
    expect(withJunkCookie.status).toBe(HttpStatus.OK);
    expect(withJunkCookie.body).toEqual({ status: "ok" });
  });

  it("[T-9] composing the modules keeps the session guard on every kudos, reaction and moderation route", async () => {
    const server = app.getHttpServer();

    // EP-3: the board read.
    const board = await request(server).get("/api/v1/kudos");
    expect(board.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(board.body.statusCode).toBe(HttpStatus.UNAUTHORIZED);

    // EP-4: the post. The guard runs before the pipe, so even a *valid* body is
    // answered 401 here and nothing can be persisted.
    const posted = await request(server)
      .post("/api/v1/kudos")
      .send({ recipient: "someone@kudos.local", message: "thanks!" });
    expect(posted.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(posted.headers["set-cookie"]).toBeUndefined();

    // EP-5: the reaction upsert.
    const reacted = await request(server)
      .put("/api/v1/kudos/no-such-kudos/reactions")
      .send({ emoji: "👍" });
    expect(reacted.status).toBe(HttpStatus.UNAUTHORIZED);

    // EP-6: the moderation hide - the session is resolved before the role rule,
    // so an anonymous caller gets 401, never 403.
    const hidden = await request(server).post("/api/v1/kudos/no-such-kudos/hide");
    expect(hidden.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(hidden.body.statusCode).toBe(HttpStatus.UNAUTHORIZED);

    // EP-2 stays guarded too: only /health and POST /auth/login are public.
    const session = await request(server).get("/api/v1/auth/session");
    expect(session.status).toBe(HttpStatus.UNAUTHORIZED);

    // And nothing answered a 404 either, i.e. these routes really are mounted
    // behind the guard rather than missing from the composed app.
    expect(board.status).not.toBe(HttpStatus.NOT_FOUND);
    expect(reacted.status).not.toBe(HttpStatus.NOT_FOUND);
    expect(hidden.status).not.toBe(HttpStatus.NOT_FOUND);
  });

  it("[T-9] the global ValidationPipe keeps 400 as its error status on the booted app", async () => {
    // Driven through the public login route so the session guard cannot
    // short-circuit the pipe: a malformed body is a 400 client error with a
    // message, never a silent drop and never a 500.
    const malformed = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: "" });

    expect(malformed.status).toBe(HttpStatus.BAD_REQUEST);
    expect(malformed.body.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(malformed.body.message).toBeDefined();
    expect(malformed.headers["set-cookie"]).toBeUndefined();

    // An unexpected extra field is likewise rejected (forbidNonWhitelisted).
    const extra = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        email: "member@kudos.local",
        password: "whatever-it-is",
        admin: true,
      });
    expect(extra.status).toBe(HttpStatus.BAD_REQUEST);
    expect(extra.headers["set-cookie"]).toBeUndefined();
  });
});
