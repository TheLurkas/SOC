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

  // Block direct sign-up — only admins can create users via POST /users
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.all('/api/auth/sign-up/*', async (req, res, next) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const prisma = app.get('PrismaService');
    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    if (user?.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  });

  // Mount Better Auth as raw Express middleware
  const betterAuthHandler = toNodeHandler(auth);
  expressApp.all('/api/auth/*', betterAuthHandler);

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
