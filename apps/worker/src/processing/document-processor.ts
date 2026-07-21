import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import {
  ChunkConfig,
  JobStatus,
  ProcessingStage,
  ProcessingStatus,
  type IngestJobV1,
  type StorageProvider,
  type VectorRecord,
} from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';
import { STORAGE_PROVIDER } from '../storage/storage.tokens.js';
import { TEXT_EXTRACTOR, type TextExtractor } from './text-extractor.interface.js';
import { ChunkingService } from './chunking.service.js';
import { EmbeddingService } from './embedding.service.js';
import { VectorStoreService } from './vector-store.service.js';

interface LoadedContext {
  orgId: string;
  spaceId: string;
  documentId: string;
  versionId: string;
  storageKey: string | null;
  mimeType: string | null;
  fileName: string;
  chunkConfig: unknown;
  jobId: string | null;
}

/**
 * Orchestrates the ingest pipeline for one document version:
 *   extract -> normalize -> chunk -> embed -> store.
 * Idempotent: existing chunks for the version are cleared before writing, so
 * redelivery and reprocess are safe. Status is mirrored into Postgres at each step.
 */
@Injectable()
export class DocumentProcessor {
  private readonly logger = new Logger(DocumentProcessor.name);

  constructor(
    private readonly database: DatabaseService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(TEXT_EXTRACTOR) private readonly extractor: TextExtractor,
    private readonly chunking: ChunkingService,
    private readonly embeddings: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
  ) {}

  async process(payload: IngestJobV1): Promise<void> {
    const ctx = await this.load(payload);
    if (!ctx) {
      // Document/version was deleted after enqueue; ack the job.
      this.logger.warn({ versionId: payload.versionId }, 'ingest target not found; skipping');
      return;
    }
    if (!ctx.storageKey) {
      await this.setFailed(ctx, new Error('missing storage_key'));
      throw new Error(`Version ${ctx.versionId} has no storage_key`);
    }

    const startedAt = Date.now();
    await this.setProcessing(ctx);

    try {
      // Idempotency: clear any prior chunks/vectors for this version.
      await this.vectorStore.deleteByVersion(ctx.versionId);

      const buffer = await this.storage.get(ctx.storageKey);
      const mimeType = ctx.mimeType ?? payload.mimeType ?? 'application/octet-stream';

      const extractStart = Date.now();
      const extraction = await this.extractor.extract(buffer, mimeType, ctx.fileName);
      const extractMs = Date.now() - extractStart;

      const cfg = ChunkConfig.parse(
        typeof ctx.chunkConfig === 'string' ? JSON.parse(ctx.chunkConfig) : (ctx.chunkConfig ?? {}),
      );
      const pieces = this.chunking.chunk(extraction.pages, {
        chunkSize: cfg.chunkSize,
        chunkOverlap: cfg.chunkOverlap,
      });

      if (pieces.length === 0) {
        await this.setNeedsReview(ctx, 'No extractable text found', extraction.warnings);
        this.logger.warn({ documentId: ctx.documentId }, 'no chunks produced; marked needs_review');
        return;
      }

      // Persist chunk rows (without embeddings yet), then embed, then attach vectors.
      const inserted = await this.insertChunks(ctx, pieces);

      const embedStart = Date.now();
      const vectors = await this.embeddings.embedAll(pieces.map((p) => p.content));
      const embedMs = Date.now() - embedStart;

      if (vectors.length !== inserted.length) {
        throw new Error(`Embedding count ${vectors.length} != chunk count ${inserted.length}`);
      }

      const records: VectorRecord[] = inserted.map((row, i) => ({
        chunkId: row.id,
        organizationId: ctx.orgId,
        spaceId: ctx.spaceId,
        documentId: ctx.documentId,
        versionId: ctx.versionId,
        embedding: vectors[i]!,
        embeddingModel: this.embeddings.model,
      }));
      await this.vectorStore.upsert(records);

      const tokenCount = pieces.reduce((sum, p) => sum + p.tokenCount, 0);
      await this.setCompleted(ctx, {
        extractMs,
        embedMs,
        chunkCount: pieces.length,
        tokenCount,
        warnings: extraction.warnings,
        embeddingModel: this.embeddings.model,
      });

      this.logger.log(
        {
          documentId: ctx.documentId,
          versionId: ctx.versionId,
          chunks: pieces.length,
          tokenCount,
          totalMs: Date.now() - startedAt,
          warnings: extraction.warnings.length,
        },
        'document processed',
      );
    } catch (err) {
      await this.setFailed(ctx, err);
      throw err; // surface to BullMQ for retry/backoff
    }
  }

  private async load(payload: IngestJobV1): Promise<LoadedContext | null> {
    const row = await this.database.db
      .selectFrom('document_versions as v')
      .innerJoin('documents as d', 'd.id', 'v.document_id')
      .innerJoin('knowledge_base as s', 's.id', 'd.knowledge_base_id')
      .select([
        'd.organization_id as orgId',
        'd.knowledge_base_id as spaceId',
        'd.id as documentId',
        'v.id as versionId',
        'v.storage_key as storageKey',
        'v.mime_type as mimeType',
        'd.file_name as fileName',
        's.chunk_config as chunkConfig',
      ])
      .where('v.id', '=', payload.versionId)
      .where('d.organization_id', '=', payload.organizationId)
      .executeTakeFirst();
    if (!row) return null;

    const job = await this.database.db
      .selectFrom('processing_jobs')
      .select('id')
      .where('version_id', '=', payload.versionId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    return { ...row, jobId: job?.id ?? null };
  }

  private async insertChunks(
    ctx: LoadedContext,
    pieces: ReturnType<ChunkingService['chunk']>,
  ): Promise<Array<{ id: string; chunk_index: number }>> {
    const rows = pieces.map((p) => ({
      organization_id: ctx.orgId,
      knowledge_base_id: ctx.spaceId,
      document_id: ctx.documentId,
      version_id: ctx.versionId,
      chunk_index: p.index,
      content: p.content,
      token_count: p.tokenCount,
      page_number: p.pageNumber,
      content_hash: createHash('sha256').update(p.content).digest('hex'),
      embedding_model: this.embeddings.model,
    }));
    const inserted = await this.database.db
      .insertInto('chunks')
      .values(rows)
      .returning(['id', 'chunk_index'])
      .execute();
    // Align with pieces order (piece.index === array position).
    return inserted.sort((a, b) => a.chunk_index - b.chunk_index);
  }

  // ---- status transitions (mirrored into Postgres) ----

  private async setProcessing(ctx: LoadedContext): Promise<void> {
    await this.database.db
      .updateTable('documents')
      .set({ status: ProcessingStatus.Processing, error_message: null })
      .where('id', '=', ctx.documentId)
      .execute();
    await this.database.db
      .updateTable('document_versions')
      .set({ status: ProcessingStatus.Processing, error_message: null })
      .where('id', '=', ctx.versionId)
      .execute();
    if (ctx.jobId) {
      await this.database.db
        .updateTable('processing_jobs')
        .set({ stage: ProcessingStage.Extract, status: JobStatus.Processing, attempts: sql<number>`attempts + 1` })
        .where('id', '=', ctx.jobId)
        .execute();
    }
  }

  private async setCompleted(ctx: LoadedContext, metrics: Record<string, unknown>): Promise<void> {
    await this.database.db
      .updateTable('documents')
      .set({ status: ProcessingStatus.Completed, error_message: null })
      .where('id', '=', ctx.documentId)
      .execute();
    await this.database.db
      .updateTable('document_versions')
      .set({ status: ProcessingStatus.Completed })
      .where('id', '=', ctx.versionId)
      .execute();
    if (ctx.jobId) {
      await this.database.db
        .updateTable('processing_jobs')
        .set({ stage: ProcessingStage.Complete, status: JobStatus.Completed, metrics })
        .where('id', '=', ctx.jobId)
        .execute();
    }
  }

  private async setNeedsReview(
    ctx: LoadedContext,
    reason: string,
    warnings: string[],
  ): Promise<void> {
    await this.database.db
      .updateTable('documents')
      .set({ status: ProcessingStatus.NeedsReview, error_message: reason })
      .where('id', '=', ctx.documentId)
      .execute();
    await this.database.db
      .updateTable('document_versions')
      .set({ status: ProcessingStatus.NeedsReview, error_message: reason })
      .where('id', '=', ctx.versionId)
      .execute();
    if (ctx.jobId) {
      await this.database.db
        .updateTable('processing_jobs')
        .set({ stage: ProcessingStage.Complete, status: JobStatus.Completed, metrics: { reason, warnings } })
        .where('id', '=', ctx.jobId)
        .execute();
    }
  }

  private async setFailed(ctx: LoadedContext, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await this.database.db
      .updateTable('documents')
      .set({ status: ProcessingStatus.Failed, error_message: message })
      .where('id', '=', ctx.documentId)
      .execute()
      .catch(() => undefined);
    await this.database.db
      .updateTable('document_versions')
      .set({ status: ProcessingStatus.Failed, error_message: message })
      .where('id', '=', ctx.versionId)
      .execute()
      .catch(() => undefined);
    if (ctx.jobId) {
      await this.database.db
        .updateTable('processing_jobs')
        .set({ status: JobStatus.Failed, error: message })
        .where('id', '=', ctx.jobId)
        .execute()
        .catch(() => undefined);
    }
  }
}
