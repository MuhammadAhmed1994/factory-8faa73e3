import "reflect-metadata";
import { HttpStatus, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadAppConfig } from "./app.config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // An invalid request body must be rejected with 400 (AC-8 / AC-9) instead of
  // being silently dropped or surfacing as a 500. `whitelist` + 
  // `forbidNonWhitelisted` make a wrong-shaped body a client error.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.BAD_REQUEST,
    }),
  );

  // The Next.js web app calls this API from the browser with session credentials.
  app.enableCors({ origin: true, credentials: true });

  const { port } = loadAppConfig();
  await app.listen(port);
}

void bootstrap();
