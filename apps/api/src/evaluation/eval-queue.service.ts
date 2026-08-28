import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { QUEUE, type RagEvalJobV1 } from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';

/** Producer for the `eval` queue. The in-API EvalRunner consumes these. */
@Injectable()
export class EvalQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(EvalQueueService.name);
  private readonly connection: Redis;
  private readonly queue: Queue;

  constructor(config: AppConfigService) {
    this.connection = new IORedis(config.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE.Eval, { connection: this.connection, prefix: config.env.QUEUE_PREFIX });
  }

  async enqueue(payload: RagEvalJobV1): Promise<string> {
    const job = await this.queue.add(payload.jobType, payload, {
      jobId: payload.runId,
      attempts: 1, // a failed run is marked failed; don't silently re-run
      removeOnComplete: 200,
      removeOnFail: 500,
    });
    this.logger.log({ runId: payload.runId, datasetId: payload.datasetId }, 'eval run enqueued');
    return job.id ?? payload.runId;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
