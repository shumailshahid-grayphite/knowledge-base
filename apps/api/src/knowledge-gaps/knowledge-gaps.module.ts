import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { KnowledgeGapsService } from './knowledge-gaps.service.js';
import { KnowledgeGapsController } from './knowledge-gaps.controller.js';

/**
 * Knowledge Gaps V1. Exports the service so the chat/retrieval flow can record
 * signals; DatabaseService, AppConfigService and EMBEDDING_PROVIDER are global.
 */
@Module({
  imports: [AuthModule],
  providers: [KnowledgeGapsService],
  controllers: [KnowledgeGapsController],
  exports: [KnowledgeGapsService],
})
export class KnowledgeGapsModule {}
