import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { QUEUE, type IngestJobV1 } from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';

/**
 * API-side producer. The API ONLY enqueues; it never processes. The worker
 * consumes these jobs (see docs/CONTRACTS.md). Nothing here parses or embeds.
 */
@Injectable()
export class IngestQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(IngestQueueService.name);
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(config: AppConfigService) {
    this.connection = new IORedis(config.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE.Ingest, {
      connection: this.connection,
      prefix: config.env.QUEUE_PREFIX,
    });
  }

  /**
   * Enqueue an ingest job. For first ingest, jobId == versionId so accidental
   * double-enqueues dedupe. Reprocess uses a distinct jobId so it isn't dropped.
   */
  async enqueueIngest(payload: IngestJobV1): Promise<string> {
    const jobId = payload.reprocess ? `${payload.versionId}:r:${Date.now()}` : payload.versionId;
    const job = await this.queue.add(payload.jobType, payload, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    this.logger.log(
      { queueJobId: job.id, versionId: payload.versionId, reprocess: payload.reprocess },
      'ingest job enqueued',
    );
    return job.id ?? jobId;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
