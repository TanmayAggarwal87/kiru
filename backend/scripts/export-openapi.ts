import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';

async function exportOpenApi() {
  try {
    const app = await NestFactory.create(AppModule, { logger: false });

    const swaggerConfig = new DocumentBuilder()
      .setTitle('Kiru API')
      .setDescription('Kiru automated video clip generation API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'worker-token')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    const outDir = path.join(process.cwd(), 'openapi');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const outPath = path.join(outDir, 'openapi.json');
    fs.writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n');
    console.log(`OpenAPI document exported to ${outPath}`);

    await app.close();
    process.exit(0);
  } catch (err) {
    console.error('Failed to export OpenAPI:', err);
    process.exit(1);
  }
}

void exportOpenApi();
