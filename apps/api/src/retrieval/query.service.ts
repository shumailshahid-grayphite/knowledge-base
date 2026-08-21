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
import { KnowledgeGapsService } from '../knowledge-gaps/knowledge-gaps.service.js';

@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly spaces: SpacesService,
    private readonly retrieval: RetrievalService,
    private readonly answer: AnswerService,
    private readonly gaps: KnowledgeGapsService,
  ) {}

  async ask(user: AuthUser, spaceId: string, req: QueryRequest): Promise<QueryResponse> {
    const startedAt = Date.now();
    await this.spaces.requireSpace(user.organizationId, spaceId);

    // Edit-and-resend: drop the edited turn and everything after it so this
    // request replaces that point in the conversation.
    if (req.sessionId && req.editFromMessageId) {
      await this.truncateFrom(user, spaceId, req.sessionId, req.editFromMessageId);
    }

    // Resolve an optional folder filter to its materialized-path prefix so search
    // scopes to that folder AND its whole subtree. folderId wins over any raw prefix.
    const filters = await this.resolveFolderFilter(user, spaceId, req.filters);

    // Prior turns of this conversation (for follow-up questions).
    const history = req.sessionId ? await this.loadHistory(user, spaceId, req.sessionId) : [];

    // Retrieval query: an attached draft drives retrieval toward the company docs
    // worth comparing it against; otherwise a follow-up is rewritten standalone
    // ("what about seniors?" -> the actual subject). The answer always uses the
    // user's real question.
    let searchQuery: string;
    if (req.attachment) {
      searchQuery = `${req.question}\n\n${req.attachment.text.slice(0, 2000)}`;
    } else {
      searchQuery = await this.answer.condenseQuery(req.question, history);
      if (searchQuery !== req.question) {
        this.logger.debug({ original: req.question, searchQuery }, 'rewrote follow-up for retrieval');
      }
    }

    const chunks = await this.retrieval.retrieve({
      organizationId: user.organizationId,
      spaceId,
      question: searchQuery,
      topK: req.topK,
      filters,
    });

    // Always answer: grounded + cited when the KB has relevant context, general
    // knowledge (no citations) otherwise. An attachment is reviewed against context.
    const generated = await this.answer.generate(req.question, chunks, history, req.attachment);
    const answer = generated.text;
    const citations: Citation[] = generated.citations;
    const model = generated.model;
    const usage = generated.usage;
    const noAnswer = false;

    const { sessionId, userMessageId } = await this.persist(user, spaceId, req, {
      answer,
      citations,
      chunks,
      model,
      usage,
      latencyMs: Date.now() - startedAt,
    });

    // Knowledge Gaps: record a signal when the KB inadequately supported this
    // question. Skipped for attachment turns (the user supplied their own doc).
    // Best-effort — recordIfGap never throws, so chat is unaffected either way.
    if (!req.attachment) {
      await this.gaps.recordIfGap({
        user,
        sessionId,
        messageId: userMessageId,
        question: req.question,
        standaloneQuestion: searchQuery,
        evidence: chunks.map((c) => ({
          documentName: c.documentName,
          score: c.score,
          pageNumber: c.pageNumber,
        })),
      });
    }

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
      .select(['id', 'role', 'content', 'citations', 'attachments'])
      .where('session_id', '=', sessionId)
      .where('organization_id', '=', user.organizationId)
      .orderBy('created_at', 'asc')
      .execute();

    return {
      id: session.id,
      title: session.title,
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        citations: (r.citations ?? []) as unknown[],
        attachments: (r.attachments ?? []) as unknown[],
      })),
    };
  }

  /** Rename a chat session. */
  async renameChat(user: AuthUser, spaceId: string, sessionId: string, title: string) {
    await this.spaces.requireSpace(user.organizationId, spaceId);
    const res = await this.database.db
      .updateTable('query_sessions')
      .set({ title: title.trim().slice(0, 120) })
      .where('id', '=', sessionId)
      .where('organization_id', '=', user.organizationId)
      .where('knowledge_base_id', '=', spaceId)
      .executeTakeFirst();
    if (!res.numUpdatedRows) throw new NotFoundException('Chat not found');
    return { id: sessionId, title };
  }

  /** Delete a chat session (messages cascade via FK). */
  async deleteChat(user: AuthUser, spaceId: string, sessionId: string) {
    await this.spaces.requireSpace(user.organizationId, spaceId);
    const res = await this.database.db
      .deleteFrom('query_sessions')
      .where('id', '=', sessionId)
      .where('organization_id', '=', user.organizationId)
      .where('knowledge_base_id', '=', spaceId)
      .executeTakeFirst();
    if (!res.numDeletedRows) throw new NotFoundException('Chat not found');
    return { id: sessionId };
  }

  /**
   * For edit-and-resend: delete the target message and every message created at or
   * after it (validated to belong to this user's session), so the caller can re-ask
   * from that point.
   */
  private async truncateFrom(
    user: AuthUser,
    spaceId: string,
    sessionId: string,
    messageId: string,
  ): Promise<void> {
    const session = await this.database.db
      .selectFrom('query_sessions')
      .select('id')
      .where('id', '=', sessionId)
      .where('organization_id', '=', user.organizationId)
      .where('knowledge_base_id', '=', spaceId)
      .executeTakeFirst();
    if (!session) return;

    const target = await this.database.db
      .selectFrom('query_messages')
      .select('created_at')
      .where('id', '=', messageId)
      .where('session_id', '=', sessionId)
      .where('organization_id', '=', user.organizationId)
      .executeTakeFirst();
    if (!target) return;

    await this.database.db
      .deleteFrom('query_messages')
      .where('session_id', '=', sessionId)
      .where('organization_id', '=', user.organizationId)
      .where('created_at', '>=', target.created_at)
      .execute();
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
  ): Promise<{ sessionId: string; userMessageId: string | null }> {
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

    const inserted = await this.database.db
      .insertInto('query_messages')
      .values([
        {
          organization_id: user.organizationId,
          session_id: sessionId,
          role: 'user',
          content: req.question,
          // Record the attachment NAME only (the draft text stays ephemeral).
          attachments: JSON.stringify(req.attachment ? [{ name: req.attachment.name }] : []),
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
      .returning(['id', 'role'])
      .execute();
    const userMessageId = inserted.find((r) => r.role === 'user')?.id ?? null;

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

    return { sessionId, userMessageId };
  }
}
