import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { QUEUE, type SyncJobV1 } from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';

/** Producer for the `sync` queue. The worker's SyncWorker consumes these. */
@Injectable()
export class SyncQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(SyncQueueService.name);
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(config: AppConfigService) {
    this.connection = new IORedis(config.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE.Sync, { connection: this.connection, prefix: config.env.QUEUE_PREFIX });
  }

  async enqueueSync(payload: SyncJobV1): Promise<string> {
    const job = await this.queue.add(payload.jobType, payload, {
      jobId: payload.syncJobId,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    });
    this.logger.log({ syncJobId: payload.syncJobId, connectorId: payload.connectorId }, 'sync job enqueued');
    return job.id ?? payload.syncJobId;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
