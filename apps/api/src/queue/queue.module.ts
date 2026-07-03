import { Global, Module } from '@nestjs/common';
import { IngestQueueService } from './ingest-queue.service.js';

@Global()
@Module({
  providers: [IngestQueueService],
  exports: [IngestQueueService],
})
export class QueueModule {}
