import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module.js';
import { TEXT_EXTRACTOR } from './text-extractor.interface.js';
import { DefaultTextExtractor } from './default-text-extractor.js';
import { ChunkingService } from './chunking.service.js';
import { EmbeddingService } from './embedding.service.js';
import { VectorStoreService } from './vector-store.service.js';
import { DocumentProcessor } from './document-processor.js';

@Module({
  imports: [ProvidersModule],
  providers: [
    DefaultTextExtractor,
    // Bind the extractor interface to the default impl (swap here for a different extractor).
    { provide: TEXT_EXTRACTOR, useExisting: DefaultTextExtractor },
    ChunkingService,
    EmbeddingService,
    VectorStoreService,
    DocumentProcessor,
  ],
  exports: [DocumentProcessor, EmbeddingService, VectorStoreService],
})
export class ProcessingModule {}
