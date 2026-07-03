import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { StorageModule } from './storage/storage.module.js';
import { WorkerModule } from './queue/worker.module.js';
import { ConnectorsModule } from './connectors/connectors.module.js';

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
        transport: isProd ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    ConfigModule,
    DatabaseModule,
    StorageModule,
    WorkerModule,
    ConnectorsModule,
  ],
})
export class AppModule {}
