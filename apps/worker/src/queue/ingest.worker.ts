import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Worker } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { QUEUE, type IngestJobV1 } from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { DocumentProcessor } from '../processing/document-processor.js';

/**
 * Consumes the `ingest` queue and runs the DocumentProcessor. This is the entire
 * coupling between API and worker — the frozen v1 payload (docs/CONTRACTS.md).
 * BullMQ handles retries/backoff; the processor re-throws on failure.
 */
@Injectable()
export class IngestWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestWorker.name);
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly config: AppConfigService,
    private readonly database: DatabaseService,
    private readonly processor: DocumentProcessor,
  ) {}

  onModuleInit(): void {
    this.connection = new IORedis(this.config.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.worker = new Worker(
      QUEUE.Ingest,
      async (job) => {
        const data = job.data as IngestJobV1;
        // Bind the tenant so RLS scopes every query this job runs.
        await this.database.runWithTenant(data.organizationId, () => this.processor.process(data));
      },
      {
        connection: this.connection,
        prefix: this.config.env.QUEUE_PREFIX,
        concurrency: this.config.env.WORKER_CONCURRENCY,
      },
    );

    this.worker.on('completed', (job) => this.logger.debug(`job ${job.id} completed`));
    this.worker.on('failed', (job, err) =>
      this.logger.error({ jobId: job?.id, err: err.message }, 'ingest job failed'),
    );
    this.worker.on('error', (err) => this.logger.error({ err: err.message }, 'worker error'));

    this.logger.log(`ingest worker listening (concurrency=${this.config.env.WORKER_CONCURRENCY})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.connection?.quit();
  }
}
