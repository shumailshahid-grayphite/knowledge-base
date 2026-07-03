import 'reflect-metadata';
import './bootstrap-env.js'; // MUST precede any module that reads process.env at import time

import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/app-config.service.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors();
  app.enableShutdownHooks();

  const config = app.get(AppConfigService);
  await app.listen(config.env.API_PORT);
  app.get(PinoLogger).log(`API listening on :${config.env.API_PORT}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
