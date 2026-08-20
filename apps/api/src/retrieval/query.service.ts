import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { AnswerService, type ChatTurn } from './answer.service.js';

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

    // Resolve an optional folder filter to its materialized-path prefix so search
    // scopes to that folder AND its whole subtree. folderId wins over any raw prefix.
    const filters = await this.resolveFolderFilter(user, spaceId, req.filters);

    // Prior turns of this conversation (for follow-up questions).
    const history = req.sessionId ? await this.loadHistory(user, spaceId, req.sessionId) : [];

    const chunks = await this.retrieval.retrieve({
      organizationId: user.organizationId,
      spaceId,
      question: req.question,
      topK: req.topK,
      filters,
    });

    // Always answer: grounded + cited when the KB has relevant context, general
    // knowledge (no citations) otherwise.
    const generated = await this.answer.generate(req.question, chunks, history);
    const answer = generated.text;
    const citations: Citation[] = generated.citations;
    const model = generated.model;
    const usage = generated.usage;
    const noAnswer = false;

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

  /** Turn filters.folderId into a folder_path prefix (scoped to org+space). */
  private async resolveFolderFilter(
    user: AuthUser,
    spaceId: string,
    filters: QueryRequest['filters'],
  ): Promise<QueryRequest['filters']> {
    if (!filters?.folderId) return filters;
    const folder = await this.database.db
      .selectFrom('folders')
      .select('path')
      .where('id', '=', filters.folderId)
      .where('knowledge_base_id', '=', spaceId)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    if (!folder) throw new NotFoundException('Folder not found in this space');
    return { ...filters, folderPathPrefix: folder.path };
  }

  /** Recent turns of a session (validated as belonging to this user's KB). */
  private async loadHistory(
    user: AuthUser,
    spaceId: string,
    sessionId: string,
  ): Promise<ChatTurn[]> {
    const session = await this.database.db
      .selectFrom('query_sessions')
      .select('id')
      .where('id', '=', sessionId)
      .where('organization_id', '=', user.organizationId)
      .where('knowledge_base_id', '=', spaceId)
      .executeTakeFirst();
    if (!session) return [];

    const rows = await this.database.db
      .selectFrom('query_messages')
      .select(['role', 'content'])
      .where('session_id', '=', sessionId)
      .where('organization_id', '=', user.organizationId)
      .where('role', 'in', ['user', 'assistant'])
      .orderBy('created_at', 'asc')
      .execute();

    // Keep the last few turns to bound the prompt.
    return rows.slice(-8).map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }));
  }

  /** Chat sessions for the sidebar (most recently active first). */
  async listChats(user: AuthUser, spaceId: string) {
    await this.spaces.requireSpace(user.organizationId, spaceId);
    return this.database.db
      .selectFrom('query_sessions')
      .select(['id', 'title', 'created_at as createdAt', 'updated_at as updatedAt'])
      .where('organization_id', '=', user.organizationId)
      .where('knowledge_base_id', '=', spaceId)
      .orderBy('updated_at', 'desc')
      .limit(100)
      .execute();
  }

  /** One chat's full message history. */
  async getChat(user: AuthUser, spaceId: string, sessionId: string) {
    await this.spaces.requireSpace(user.organizationId, spaceId);
    const session = await this.database.db
      .selectFrom('query_sessions')
      .select(['id', 'title'])
      .where('id', '=', sessionId)
      .where('organization_id', '=', user.organizationId)
      .where('knowledge_base_id', '=', spaceId)
      .executeTakeFirst();
    if (!session) throw new NotFoundException('Chat not found');

    const rows = await this.database.db
      .selectFrom('query_messages')
      .select(['role', 'content', 'citations'])
      .where('session_id', '=', sessionId)
      .where('organization_id', '=', user.organizationId)
      .orderBy('created_at', 'asc')
      .execute();

    return {
      id: session.id,
      title: session.title,
      messages: rows.map((r) => ({
        role: r.role,
        content: r.content,
        citations: (r.citations ?? []) as unknown[],
      })),
    };
  }

  async recentLogs(user: AuthUser, spaceId: string) {
    await this.spaces.requireSpace(user.organizationId, spaceId);
    return this.database.db
      .selectFrom('retrieval_logs')
      .select(['id', 'query', 'answer', 'citations', 'model', 'latency_ms as latencyMs', 'created_at as createdAt'])
      .where('organization_id', '=', user.organizationId)
      .where('knowledge_base_id', '=', spaceId)
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
        .where('knowledge_base_id', '=', spaceId)
        .executeTakeFirst();
      if (!existing) sessionId = null;
    }
    if (!sessionId) {
      const created = await this.database.db
        .insertInto('query_sessions')
        .values({
          organization_id: user.organizationId,
          knowledge_base_id: spaceId,
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
        knowledge_base_id: spaceId,
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

    // Bump session recency so it sorts to the top of the chat list.
    await this.database.db
      .updateTable('query_sessions')
      .set({ updated_at: new Date() })
      .where('id', '=', sessionId)
      .execute();

    return sessionId;
  }
}
