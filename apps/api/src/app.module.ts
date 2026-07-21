import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { StorageModule } from './storage/storage.module.js';
import { QueueModule } from './queue/queue.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SpacesModule } from './spaces/spaces.module.js';
import { FoldersModule } from './folders/folders.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { RetrievalModule } from './retrieval/retrieval.module.js';
import { ConnectorsModule } from './connectors/connectors.module.js';
import { HealthModule } from './health/health.module.js';
import { TenantInterceptor } from './common/tenant.interceptor.js';

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
        transport: isProd ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
        redact: ['req.headers.authorization'],
      },
    }),
    ConfigModule,
    DatabaseModule,
    StorageModule,
    QueueModule,
    ProvidersModule,
    AuthModule,
    SpacesModule,
    FoldersModule,
    DocumentsModule,
    RetrievalModule,
    ConnectorsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: TenantInterceptor }],
})
export class AppModule {}
