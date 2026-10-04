import "reflect-metadata";
import { BadRequestException, Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DEFAULT_PORT } from "./app.config";

/**
 * Bootstrap entrypoint for the Team Kudos Board API.
 *
 * - A global `ValidationPipe` maps an invalid request body to **400** (see
 *   AC-8/AC-9), never a silent drop or a 500.
 * - The app listens on the configured `PORT` (default from app.config.ts).
 */
export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === "test" ? false : new Logger("Bootstrap"),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Ignore properties the DTO does not declare...
      whitelist: true,
      // ...and reject them outright so a bad body fails loudly, not silently.
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      // A missing/empty body is a validation failure -> 400 (not 500).
      exceptionFactory: (errors) =>
        new BadRequestException(
          errors.map((error) => ({
            property: error.property,
            constraints: error.constraints,
          })),
        ),
    }),
  );

  app.enableShutdownHooks();

  const port = Number.parseInt(process.env.PORT ?? "", 10);

  await app.listen(Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT);
}

void bootstrap();
