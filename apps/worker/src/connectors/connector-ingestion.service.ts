import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  CONTRACT_VERSION,
  SUPPORTED_MIME_TYPES,
  type ConnectorContext,
  type ConnectorCredentials,
  type IngestJobV1,
  type RemoteFile,
  type SourceConnector,
  type StorageProvider,
  type SyncJobV1,
} from '@kb/shared';
import { DatabaseService } from '../database/database.service.js';
import { STORAGE_PROVIDER } from '../storage/storage.tokens.js';
import { ConnectorSecretsService } from './connector-secrets.service.js';
import { IngestProducerService } from './ingest-producer.service.js';
import { CONNECTOR_RESOLVER, type ConnectorResolver } from './connector-resolver.js';

const SUPPORTED = new Set<string>(SUPPORTED_MIME_TYPES);

interface SyncStats {
  found: number;
  new: number;
  updated: number;
  skipped: number;
  failed: number;
}

/**
 * Executes a connector sync: list files → diff by external_version/content_hash →
 * download changed files → create document/version rows → enqueue standard `ingest`
 * jobs (reusing the whole pipeline). Connectors produce files; this never parses.
 */
@Injectable()
export class ConnectorIngestionService {
  private readonly logger = new Logger(ConnectorIngestionService.name);

  constructor(
    private readonly database: DatabaseService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly secrets: ConnectorSecretsService,
    private readonly ingestProducer: IngestProducerService,
    @Inject(CONNECTOR_RESOLVER) private readonly resolveConnector: ConnectorResolver,
  ) {}

  async runSync(payload: SyncJobV1): Promise<void> {
    await this.database.db
      .updateTable('sync_jobs')
      .set({ status: 'running', started_at: new Date() })
      .where('id', '=', payload.syncJobId)
      .execute();

    const stats: SyncStats = { found: 0, new: 0, updated: 0, skipped: 0, failed: 0 };
    try {
      const connectorRow = await this.database.db
        .selectFrom('source_connectors')
        .selectAll()
        .where('id', '=', payload.connectorId)
        .where('organization_id', '=', payload.organizationId)
        .executeTakeFirstOrThrow();

      const connector = this.resolveConnector(connectorRow.type);
      const credentials = await this.freshCredentials(connector, payload.connectorId, payload.organizationId);
      const ctx: ConnectorContext = {
        organizationId: payload.organizationId,
        connectorId: payload.connectorId,
        config: (connectorRow.config as Record<string, unknown>) ?? {},
        credentials,
      };

      const { files, nextCursor } = await connector.listFiles(ctx, payload.selector, payload.cursor);
      stats.found = files.length;

      for (const file of files) {
        try {
          await this.syncFile(connector, ctx, payload, file, stats);
        } catch (err) {
          stats.failed += 1;
          this.logger.error({ file: file.name, err: msg(err) }, 'file sync failed');
        }
      }

      const status = stats.failed > 0 ? (stats.new + stats.updated > 0 ? 'partial' : 'failed') : 'completed';
      await this.database.db
        .updateTable('sync_jobs')
        .set({
          status,
          stats: JSON.stringify(stats),
          cursor: nextCursor,
          finished_at: new Date(),
        })
        .where('id', '=', payload.syncJobId)
        .execute();

      this.logger.log({ syncJobId: payload.syncJobId, ...stats, status }, 'sync complete');
    } catch (err) {
      await this.database.db
        .updateTable('sync_jobs')
        .set({ status: 'failed', error: msg(err), stats: JSON.stringify(stats), finished_at: new Date() })
        .where('id', '=', payload.syncJobId)
        .execute()
        .catch(() => undefined);
      throw err; // surface to BullMQ
    }
  }

  private async syncFile(
    connector: SourceConnector,
    ctx: ConnectorContext,
    payload: SyncJobV1,
    file: RemoteFile,
    stats: SyncStats,
  ): Promise<void> {
    const existing = await this.database.db
      .selectFrom('documents')
      .select(['id', 'external_version', 'content_hash'])
      .where('organization_id', '=', payload.organizationId)
      .where('source_connector_id', '=', payload.connectorId)
      .where('source_item_id', '=', file.sourceItemId)
      .executeTakeFirst();

    // Fast path: unchanged per source version tag.
    if (existing && file.externalVersion && existing.external_version === file.externalVersion) {
      stats.skipped += 1;
      return;
    }

    const mime = file.mimeType;
    if (!SUPPORTED.has(mime)) {
      stats.skipped += 1;
      return;
    }

    const fetched = await connector.fetchFile(ctx, file);
    const buf = await streamToBuffer(fetched.stream);
    const hash = createHash('sha256').update(buf).digest('hex');

    // Content unchanged: just refresh the version tag so we don't re-fetch next time.
    if (existing && existing.content_hash === hash) {
      await this.database.db
        .updateTable('documents')
        .set({ external_version: file.externalVersion ?? null, external_modified_at: file.modifiedAt ?? null })
        .where('id', '=', existing.id)
        .execute();
      stats.skipped += 1;
      return;
    }

    const isNew = !existing;
    let documentId: string;

    if (isNew) {
      const doc = await this.database.db
        .insertInto('documents')
        .values({
          organization_id: payload.organizationId,
          knowledge_base_id: payload.spaceId,
          source_type: connector.type,
          source_connector_id: payload.connectorId,
          source_item_id: file.sourceItemId,
          source_url: file.webUrl ?? null,
          file_name: file.name,
          mime_type: mime,
          file_size: buf.length,
          folder_path: file.folderPath ?? null,
          owner_meta: JSON.stringify(file.owner ?? {}),
          permissions: JSON.stringify(file.permissions ?? {}),
          external_created_at: file.createdAt ?? null,
          external_modified_at: file.modifiedAt ?? null,
          external_version: file.externalVersion ?? null,
          content_hash: hash,
          status: 'uploaded',
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      documentId = doc.id;
    } else {
      documentId = existing.id;
    }

    const versionNo = await this.nextVersionNo(documentId);
    const storageKey = `orgs/${payload.organizationId}/${documentId}/v${versionNo}/${sanitize(file.name)}`;
    await this.storage.put(storageKey, buf, { contentType: mime, size: buf.length });

    const version = await this.database.db
      .insertInto('document_versions')
      .values({
        organization_id: payload.organizationId,
        document_id: documentId,
        version_no: versionNo,
        storage_key: storageKey,
        mime_type: mime,
        file_size: buf.length,
        external_version: file.externalVersion ?? null,
        content_hash: hash,
        status: 'queued',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    await this.database.db
      .updateTable('documents')
      .set({
        current_version_id: version.id,
        storage_key: storageKey,
        content_hash: hash,
        external_version: file.externalVersion ?? null,
        external_modified_at: file.modifiedAt ?? null,
        status: 'queued',
        error_message: null,
      })
      .where('id', '=', documentId)
      .execute();

    await this.database.db
      .insertInto('processing_jobs')
      .values({
        organization_id: payload.organizationId,
        document_id: documentId,
        version_id: version.id,
        stage: 'received',
        status: 'queued',
      })
      .execute();

    const ingest: IngestJobV1 = {
      contractVersion: CONTRACT_VERSION,
      jobType: 'ingest_document_version',
      organizationId: payload.organizationId,
      spaceId: payload.spaceId,
      documentId,
      versionId: version.id,
      storageKey,
      mimeType: mime,
      sourceType: connector.type,
      reprocess: !isNew,
    };
    await this.ingestProducer.enqueueIngest(ingest);

    if (isNew) stats.new += 1;
    else stats.updated += 1;
  }

  private async nextVersionNo(documentId: string): Promise<number> {
    const row = await this.database.db
      .selectFrom('document_versions')
      .select((eb) => eb.fn.max('version_no').as('max'))
      .where('document_id', '=', documentId)
      .executeTakeFirst();
    return (Number(row?.max ?? 0) || 0) + 1;
  }

  private async freshCredentials(
    connector: SourceConnector,
    connectorId: string,
    organizationId: string,
  ): Promise<ConnectorCredentials> {
    const creds = await this.secrets.get(connectorId);
    const expiresAt = creds.expiresAt ? new Date(creds.expiresAt).getTime() : 0;
    if (expiresAt > 0 && expiresAt < Date.now() + 60_000 && connector.refresh) {
      const refreshed = await connector.refresh(creds);
      await this.secrets.store(connectorId, organizationId, refreshed);
      return refreshed;
    }
    return creds;
  }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sanitize(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\-]+/g, '_').slice(0, 200) || 'file';
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
