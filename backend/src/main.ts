import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const configService = app.get(ConfigService);

  // Structured logging with pino
  app.useLogger(app.get(Logger));

  // Security headers
  app.use(helmet());

  // Trust proxy for correct client IP detection behind load balancers / Cloudflare
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);

  // Body limits (video bytes never pass through the API)
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  // CORS allowlist
  app.enableCors({
    origin: configService.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
  });

  // Global exception filter for standard error envelopes
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  // URI versioning (default version '1', e.g. /v1/..., unversioned for /health/*)
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Graceful shutdown hooks
  app.enableShutdownHooks();

  // Swagger OpenAPI documentation (non-production only)
  if (!configService.isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Kiru API')
      .setDescription('Kiru automated video clip generation API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'worker-token')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = configService.get('PORT');
  await app.listen(port);
}

void bootstrap();
