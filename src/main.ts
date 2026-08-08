import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { globalValidationPipe } from './common/pipes/validation.pipe';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Without this, SIGTERM/SIGINT (including nest's own --watch restarts)
  // kill the process without running onModuleDestroy, so PrismaService never
  // closes its pool — each restart leaks connections at the DB pooler until
  // its low connection ceiling is exhausted.
  app.enableShutdownHooks();

  // ── Global prefix ────────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── CORS ─────────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Global pipes ─────────────────────────────────────────────────────────────
  app.useGlobalPipes(globalValidationPipe);

  // ── Global filters ───────────────────────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── Global interceptors ──────────────────────────────────────────────────────
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // ── Swagger / OpenAPI docs ───────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('EOS Backend API')
    .setDescription('REST API for the EOS school-management backend')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  // ── Start ────────────────────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT || '3001', 10);
  await app.listen(port);
  logger.log(`🚀 EOS Backend running on http://localhost:${port}/api/v1`);
  logger.log(`📘 Swagger docs available at http://localhost:${port}/api/docs`);
}

bootstrap();
