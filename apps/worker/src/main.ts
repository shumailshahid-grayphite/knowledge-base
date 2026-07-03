import 'reflect-metadata';
import './bootstrap-env.js'; // load env before modules read process.env

import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  // No HTTP server: the worker is a standalone context. The BullMQ Worker (started
  // in IngestWorker.onModuleInit) keeps the process alive.
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();
  app.get(PinoLogger).log('worker started');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal worker bootstrap error:', err);
  process.exit(1);
});
