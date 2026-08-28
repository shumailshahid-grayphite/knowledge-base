/**
 * Frozen queue message contract (v1). See docs/CONTRACTS.md.
 *
 * The worker depends ONLY on these payloads + Postgres + Redis + object storage.
 * There is no worker -> API call path. A Python worker can consume the same JSON.
 */

import type { SourceType } from './enums.js';

export const QUEUE = {
  Ingest: 'ingest',
  Sync: 'sync',
  Eval: 'eval',
} as const;
export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export const CONTRACT_VERSION = 1 as const;

/** Process one document version end-to-end. Producer: API upload or worker sync. */
export interface IngestJobV1 {
  contractVersion: 1;
  jobType: 'ingest_document_version';
  organizationId: string;
  spaceId: string;
  documentId: string;
  versionId: string;
  /** Where the bytes live in the object store. */
  storageKey: string;
  mimeType: string | null;
  sourceType: SourceType;
  /** true => replace existing chunks for versionId (idempotent reprocess). */
  reprocess: boolean;
}

/** Enumerate a source, diff, and enqueue ingest jobs. Producer: API connector sync. */
export interface SyncJobV1 {
  contractVersion: 1;
  jobType: 'connector_sync';
  organizationId: string;
  connectorId: string;
  spaceId: string;
  syncJobId: string;
  /** Connector-specific: siteId / driveId / folderIds, etc. */
  selector: Record<string, unknown>;
  /** Delta link / changes pageToken for incremental sync. */
  cursor: string | null;
  /**
   * Reconcile deletions: remove KB docs whose source item is no longer present in
   * a full listing. Set by auto-sync (which re-runs the connector's canonical
   * selector). Manual syncs leave it off so a one-off scoped sync can't purge docs
   * that just weren't in that selector.
   */
  reconcileDeletes?: boolean;
}

/** Run every case of an eval dataset through the production retrieval path. */
export interface RagEvalJobV1 {
  contractVersion: 1;
  jobType: 'rag_eval_run';
  organizationId: string;
  datasetId: string;
  runId: string;
  spaceId: string;
}

export type QueueJobPayload = IngestJobV1 | SyncJobV1 | RagEvalJobV1;
