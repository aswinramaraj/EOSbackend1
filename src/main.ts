import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { globalValidationPipe } from './common/pipes/validation.pipe';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  // ── Body size ────────────────────────────────────────────────────────────────
  // Express/body-parser's default JSON limit is 100kb - fine for every
  // endpoint until the attendance-cv module, the first feature to embed
  // photos as base64 data URIs directly in a JSON body (POST
  // .../face-enrollment and .../attendance/recognize can carry several
  // photos in one call) rather than a multipart file upload. Without this,
  // any request over 100kb fails as a raw, unhandled Express
  // PayloadTooLargeError before it ever reaches a controller - no
  // errorCode, no JSON envelope, just a 500 the mobile app can only show as
  // "something went wrong". Raised globally rather than scoped to just
  // those two routes since Nest has no clean per-route body-parser hook and
  // every route here already sits behind JWT + role guards.
  app.useBodyParser('json', { limit: '20mb' });
  app.useBodyParser('urlencoded', { limit: '20mb', extended: true });

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
