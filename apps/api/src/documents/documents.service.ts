import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Selectable } from 'kysely';
import type { DocumentsTable } from '@kb/db';
import {
  CONTRACT_VERSION,
  ConnectorType,
  ProcessingStage,
  ProcessingStatus,
  JobStatus,
  type AuthUser,
  type DocumentResponse,
  type IngestJobV1,
  type ListDocumentsQuery,
  type StorageProvider,
} from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';
import { SpacesService } from '../spaces/spaces.service.js';
import { IngestQueueService } from '../queue/ingest-queue.service.js';
import { STORAGE_PROVIDER } from '../storage/storage.tokens.js';
import { resolveSupportedMime, sanitizeFileName } from './mime.util.js';
import type { UploadedFileLike } from '../common/types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly spaces: SpacesService,
    private readonly queue: IngestQueueService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * Upload flow. The API validates, stores bytes, creates records, and enqueues.
   * It NEVER parses/chunks/embeds — that's the worker's job (docs/CONTRACTS.md).
   */
  async upload(
    user: AuthUser,
    spaceId: string,
    file: UploadedFileLike | undefined,
    folderId?: string,
  ): Promise<DocumentResponse> {
    if (!file) {
      throw new BadRequestException('No file provided (expected multipart field "file")');
    }
    await this.spaces.requireSpace(user.organizationId, spaceId);

    // Resolve the target folder (optional). A filed doc carries folder_id + a
    // denormalized folder_path for prefix-based subtree retrieval.
    const folder = await this.resolveFolder(user.organizationId, spaceId, folderId);

    const mimeType = resolveSupportedMime(file.originalname, file.mimetype);
    if (!mimeType) {
      throw new BadRequestException(
        `Unsupported file type. MVP supports PDF, DOCX, TXT, and Markdown.`,
      );
    }

    const fileName = sanitizeFileName(file.originalname);
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');

    // 1) Create the document shell so we have an id for the storage key.
    const doc = await this.database.db
      .insertInto('documents')
      .values({
        organization_id: user.organizationId,
        knowledge_base_id: spaceId,
        folder_id: folder?.id ?? null,
        folder_path: folder?.path ?? null,
        source_type: ConnectorType.Upload,
        file_name: fileName,
        mime_type: mimeType,
        file_size: file.size,
        content_hash: contentHash,
        status: ProcessingStatus.Uploaded,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    const storageKey = `orgs/${user.organizationId}/${doc.id}/v1/${fileName}`;

    try {
      // 2) Store the bytes.
      await this.storage.put(storageKey, file.buffer, { contentType: mimeType, size: file.size });

      // 3) Create version + processing job + link current version (one transaction).
      const versionId = await this.database.db.transaction().execute(async (trx) => {
        const version = await trx
          .insertInto('document_versions')
          .values({
            organization_id: user.organizationId,
            document_id: doc.id,
            version_no: 1,
            storage_key: storageKey,
            mime_type: mimeType,
            file_size: file.size,
            content_hash: contentHash,
            status: ProcessingStatus.Queued,
          })
          .returning(['id'])
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('processing_jobs')
          .values({
            organization_id: user.organizationId,
            document_id: doc.id,
            version_id: version.id,
            stage: ProcessingStage.Received,
            status: JobStatus.Queued,
          })
          .execute();

        await trx
          .updateTable('documents')
          .set({
            current_version_id: version.id,
            storage_key: storageKey,
            status: ProcessingStatus.Queued,
          })
          .where('id', '=', doc.id)
          .execute();

        return version.id;
      });

      // 4) Enqueue AFTER the commit so the worker never sees uncommitted rows.
      const payload: IngestJobV1 = {
        contractVersion: CONTRACT_VERSION,
        jobType: 'ingest_document_version',
        organizationId: user.organizationId,
        spaceId,
        documentId: doc.id,
        versionId,
        storageKey,
        mimeType,
        sourceType: ConnectorType.Upload,
        reprocess: false,
      };
      const queueJobId = await this.queue.enqueueIngest(payload);
      await this.database.db
        .updateTable('processing_jobs')
        .set({ queue_job_id: queueJobId })
        .where('version_id', '=', versionId)
        .execute();

      this.logger.log(
        { documentId: doc.id, versionId, spaceId, fileName },
        'document uploaded and queued',
      );
      return this.getById(user, doc.id);
    } catch (err) {
      await this.markFailed(doc.id, err);
      throw err;
    }
  }

  /** Re-run processing for the current version (replaces its chunks in the worker). */
  async reprocess(user: AuthUser, documentId: string): Promise<DocumentResponse> {
    const doc = await this.requireDocument(user.organizationId, documentId);
    if (!doc.current_version_id || !doc.storage_key) {
      throw new BadRequestException('Document has no processed version to reprocess');
    }

    await this.database.db
      .updateTable('documents')
      .set({ status: ProcessingStatus.Queued, error_message: null })
      .where('id', '=', documentId)
      .execute();
    await this.database.db
      .updateTable('document_versions')
      .set({ status: ProcessingStatus.Queued, error_message: null })
      .where('id', '=', doc.current_version_id)
      .execute();
    await this.database.db
      .insertInto('processing_jobs')
      .values({
        organization_id: user.organizationId,
        document_id: documentId,
        version_id: doc.current_version_id,
        stage: ProcessingStage.Received,
        status: JobStatus.Queued,
      })
      .execute();

    const payload: IngestJobV1 = {
      contractVersion: CONTRACT_VERSION,
      jobType: 'ingest_document_version',
      organizationId: user.organizationId,
      spaceId: doc.knowledge_base_id,
      documentId,
      versionId: doc.current_version_id,
      storageKey: doc.storage_key,
      mimeType: doc.mime_type,
      sourceType: doc.source_type,
      reprocess: true,
    };
    await this.queue.enqueueIngest(payload);
    return this.getById(user, documentId);
  }

  async list(
    user: AuthUser,
    spaceId: string,
    query: ListDocumentsQuery,
  ): Promise<DocumentResponse[]> {
    await this.spaces.requireSpace(user.organizationId, spaceId);
    let q = this.database.db
      .selectFrom('documents')
      .selectAll()
      .where('organization_id', '=', user.organizationId)
      .where('knowledge_base_id', '=', spaceId);
    if (query.status) {
      q = q.where('status', '=', query.status);
    }
    if (query.folderId) {
      q = q.where('folder_id', '=', query.folderId);
    }
    const rows = await q
      .orderBy('created_at', 'desc')
      .limit(query.limit)
      .offset(query.offset)
      .execute();
    return rows.map((r) => this.toResponse(r));
  }

  async getById(user: AuthUser, documentId: string): Promise<DocumentResponse> {
    const row = await this.requireDocument(user.organizationId, documentId);
    return this.toResponse(row);
  }

  /** Validate an optional folderId belongs to the space; returns its id+path. */
  private async resolveFolder(
    organizationId: string,
    spaceId: string,
    folderId: string | undefined,
  ): Promise<{ id: string; path: string } | null> {
    if (!folderId) return null;
    if (!UUID_RE.test(folderId)) throw new BadRequestException('Invalid folderId');
    const folder = await this.database.db
      .selectFrom('folders')
      .select(['id', 'path'])
      .where('id', '=', folderId)
      .where('knowledge_base_id', '=', spaceId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    if (!folder) throw new BadRequestException('Folder not found in this space');
    return folder;
  }

  private async requireDocument(
    organizationId: string,
    documentId: string,
  ): Promise<Selectable<DocumentsTable>> {
    const row = await this.database.db
      .selectFrom('documents')
      .selectAll()
      .where('id', '=', documentId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException('Document not found');
    }
    return row;
  }

  private async markFailed(documentId: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error({ documentId, err: message }, 'upload failed');
    await this.database.db
      .updateTable('documents')
      .set({ status: ProcessingStatus.Failed, error_message: message })
      .where('id', '=', documentId)
      .execute()
      .catch(() => undefined);
  }

  private toResponse(row: Selectable<DocumentsTable>): DocumentResponse {
    return {
      id: row.id,
      spaceId: row.knowledge_base_id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSize: row.file_size === null ? null : Number(row.file_size),
      sourceType: row.source_type,
      sourceUrl: row.source_url,
      folderId: row.folder_id,
      folderPath: row.folder_path,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
