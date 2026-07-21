import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { QUEUE, type SyncJobV1 } from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { ConnectorIngestionService } from './connector-ingestion.service.js';

/** Consumes the `sync` queue and runs connector ingestion. */
@Injectable()
export class SyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncWorker.name);
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly config: AppConfigService,
    private readonly database: DatabaseService,
    private readonly ingestion: ConnectorIngestionService,
  ) {}

  onModuleInit(): void {
    this.connection = new IORedis(this.config.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      QUEUE.Sync,
      async (job) => {
        const data = job.data as SyncJobV1;
        await this.database.runWithTenant(data.organizationId, () => this.ingestion.runSync(data));
      },
      {
        connection: this.connection,
        prefix: this.config.env.QUEUE_PREFIX,
        // Syncs are heavier and stateful; keep concurrency modest.
        concurrency: 2,
      },
    );

    this.worker.on('failed', (job, err) =>
      this.logger.error({ jobId: job?.id, err: err.message }, 'sync job failed'),
    );
    this.worker.on('error', (err) => this.logger.error({ err: err.message }, 'sync worker error'));
    this.logger.log('sync worker listening');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit();
  }
}
