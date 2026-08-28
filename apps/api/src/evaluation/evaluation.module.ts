import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SpacesModule } from '../spaces/spaces.module.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';
import { KnowledgeGapsModule } from '../knowledge-gaps/knowledge-gaps.module.js';
import { EvaluationService } from './evaluation.service.js';
import { EvaluationController } from './evaluation.controller.js';
import { EvalQueueService } from './eval-queue.service.js';
import { EvalRunnerService } from './eval-runner.service.js';

/**
 * RAG Evaluation V1. Reuses the production RetrievalService + KnowledgeGapsService
 * (imported, not reimplemented). The EvalRunner hosts a BullMQ consumer inside the
 * API process so evaluation and chat execute the exact same retrieval code.
 */
@Module({
  imports: [AuthModule, SpacesModule, RetrievalModule, KnowledgeGapsModule],
  providers: [EvaluationService, EvalQueueService, EvalRunnerService],
  controllers: [EvaluationController],
})
export class EvaluationModule {}
