import { Injectable, Logger } from '@nestjs/common';
import type {
  AuthUser,
  Citation,
  LlmTokenUsage,
  QueryRequest,
  QueryResponse,
} from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';
import { SpacesService } from '../spaces/spaces.service.js';
import { RetrievalService, type RetrievedChunk } from './retrieval.service.js';
import { AnswerService } from './answer.service.js';

const NO_ANSWER =
  "I couldn't find anything relevant in this knowledge space to answer that question.";

@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly spaces: SpacesService,
    private readonly retrieval: RetrievalService,
    private readonly answer: AnswerService,
  ) {}

  async ask(user: AuthUser, spaceId: string, req: QueryRequest): Promise<QueryResponse> {
    const startedAt = Date.now();
    await this.spaces.requireSpace(user.organizationId, spaceId);

    const chunks = await this.retrieval.retrieve({
      organizationId: user.organizationId,
      spaceId,
      question: req.question,
      topK: req.topK,
      filters: req.filters,
    });

    let answer: string;
    let noAnswer: boolean;
    let citations: Citation[];
    let model: string | undefined;
    let usage: LlmTokenUsage | undefined;

    if (chunks.length === 0) {
      // Grounding guard: no context -> do not call the model, do not fabricate.
      answer = NO_ANSWER;
      noAnswer = true;
      citations = [];
    } else {
      const generated = await this.answer.generate(req.question, chunks);
      answer = generated.text;
      citations = generated.citations;
      model = generated.model;
      usage = generated.usage;
      noAnswer = false;
    }

    const sessionId = await this.persist(user, spaceId, req, {
      answer,
      citations,
      chunks,
      model,
      usage,
      latencyMs: Date.now() - startedAt,
    });

    this.logger.log(
      { spaceId, retrieved: chunks.length, noAnswer, latencyMs: Date.now() - startedAt },
      'query answered',
    );
    return { answer, noAnswer, citations, sessionId };
  }

  async recentLogs(user: AuthUser, spaceId: string) {
    await this.spaces.requireSpace(user.organizationId, spaceId);
    return this.database.db
      .selectFrom('retrieval_logs')
      .select(['id', 'query', 'answer', 'citations', 'model', 'latency_ms as latencyMs', 'created_at as createdAt'])
      .where('organization_id', '=', user.organizationId)
      .where('space_id', '=', spaceId)
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute();
  }

  private async persist(
    user: AuthUser,
    spaceId: string,
    req: QueryRequest,
    result: {
      answer: string;
      citations: Citation[];
      chunks: RetrievedChunk[];
      model?: string;
      usage?: LlmTokenUsage;
      latencyMs: number;
    },
  ): Promise<string> {
    let sessionId = req.sessionId ?? null;

    if (sessionId) {
      const existing = await this.database.db
        .selectFrom('query_sessions')
        .select('id')
        .where('id', '=', sessionId)
        .where('organization_id', '=', user.organizationId)
        .where('space_id', '=', spaceId)
        .executeTakeFirst();
      if (!existing) sessionId = null;
    }
    if (!sessionId) {
      const created = await this.database.db
        .insertInto('query_sessions')
        .values({
          organization_id: user.organizationId,
          space_id: spaceId,
          user_id: user.id,
          title: req.question.slice(0, 80),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      sessionId = created.id;
    }

    await this.database.db
      .insertInto('query_messages')
      .values([
        {
          organization_id: user.organizationId,
          session_id: sessionId,
          role: 'user',
          content: req.question,
        },
        {
          organization_id: user.organizationId,
          session_id: sessionId,
          role: 'assistant',
          content: result.answer,
          // jsonb arrays MUST be stringified (pg treats JS arrays as SQL arrays otherwise).
          citations: JSON.stringify(result.citations),
        },
      ])
      .execute();

    await this.database.db
      .insertInto('retrieval_logs')
      .values({
        organization_id: user.organizationId,
        space_id: spaceId,
        user_id: user.id,
        session_id: sessionId,
        source: 'chat',
        query: req.question,
        filters: JSON.stringify(req.filters ?? {}),
        // Full scoring breakdown for query debugging (vector/keyword/combined/rerank/rank).
        retrieved: JSON.stringify(
          result.chunks.map((c) => ({
            chunkId: c.chunkId,
            documentId: c.documentId,
            documentName: c.documentName,
            page: c.pageNumber,
            rank: c.rank,
            vectorScore: c.vectorScore,
            keywordScore: c.keywordScore,
            combinedScore: c.combinedScore,
            rerankScore: c.rerankScore,
          })),
        ),
        answer: result.answer,
        citations: JSON.stringify(result.citations),
        model: result.model ?? null,
        token_usage: JSON.stringify(result.usage ?? {}),
        latency_ms: result.latencyMs,
      })
      .execute();

    return sessionId;
  }
}
