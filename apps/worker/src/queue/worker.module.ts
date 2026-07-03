import { Module } from '@nestjs/common';
import { ProcessingModule } from '../processing/processing.module.js';
import { IngestWorker } from './ingest.worker.js';

@Module({
  imports: [ProcessingModule],
  providers: [IngestWorker],
})
export class WorkerModule {}
