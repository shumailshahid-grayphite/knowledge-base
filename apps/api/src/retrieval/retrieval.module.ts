import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SpacesModule } from '../spaces/spaces.module.js';
import { KnowledgeGapsModule } from '../knowledge-gaps/knowledge-gaps.module.js';
import { VectorSearchService } from './vector-search.service.js';
import { KeywordSearchService } from './keyword-search.service.js';
import { RetrievalService } from './retrieval.service.js';
import { AnswerService } from './answer.service.js';
import { QueryService } from './query.service.js';
import { QueryController } from './query.controller.js';
import { AttachmentExtractorService } from './attachment-extractor.service.js';

@Module({
  imports: [AuthModule, SpacesModule, KnowledgeGapsModule],
  providers: [
    VectorSearchService,
    KeywordSearchService,
    RetrievalService,
    AnswerService,
    QueryService,
    AttachmentExtractorService,
  ],
  controllers: [QueryController],
  exports: [RetrievalService],
})
export class RetrievalModule {}
