import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth/auth';
import type { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({
    origin: ['http://localhost:3000'],
    credentials: true,
  });

  // Mount Better Auth as raw Express middleware
  const betterAuthHandler = toNodeHandler(auth);
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.all('/api/auth/*', betterAuthHandler);

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
