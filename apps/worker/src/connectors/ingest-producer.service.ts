import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { QUEUE, type IngestJobV1 } from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';

/**
 * The worker enqueues standard `ingest` jobs for files discovered during sync,
 * so connector-sourced files flow through the exact same pipeline as uploads.
 */
@Injectable()
export class IngestProducerService implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(config: AppConfigService) {
    this.connection = new IORedis(config.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE.Ingest, { connection: this.connection, prefix: config.env.QUEUE_PREFIX });
  }

  async enqueueIngest(payload: IngestJobV1): Promise<string> {
    const jobId = payload.reprocess ? `${payload.versionId}:r:${Date.now()}` : payload.versionId;
    const job = await this.queue.add(payload.jobType, payload, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    return job.id ?? jobId;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
