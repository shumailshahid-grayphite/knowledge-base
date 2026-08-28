/**
 * Kysely type definitions mirroring the SQL migrations in ../migrations.
 * The SQL is authoritative; this file is the typed view of it for the Node
 * services. When you add a migration that changes columns, update this file.
 *
 * Insert ergonomics (Kysely gotcha): a column is only OPTIONAL on insert if its
 * insert type includes `undefined`. So:
 *   - columns with a DB default  -> WithDefault<T> / Generated<T>
 *   - nullable columns           -> Nullable<T>
 *   - jsonb columns              -> JsonCol / JsonArr (accept object OR string)
 *
 * pgvector `embedding` is read/written via raw SQL in VectorStoreService, so it
 * is typed as text here (pgvector serializes to/from a '[..]' string).
 */
import type { ColumnType, Generated } from 'kysely';

/** timestamptz with a DB default: Date on read, optional on insert. */
type GenTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
/** Nullable timestamptz without default. */
type NullTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
/** Non-null column that has a DB default (optional on insert). */
type WithDefault<T> = ColumnType<T, T | undefined, T>;
/** Nullable column without default (optional on insert). */
type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;
/** bigint returned as string (see pg type parser in client.ts). */
type NullBigint = ColumnType<string | null, number | string | null | undefined, number | string | null>;
/** jsonb object: object on read; insert accepts object or pre-stringified JSON. */
type JsonCol = ColumnType<
  Record<string, unknown>,
  Record<string, unknown> | string | undefined,
  Record<string, unknown> | string
>;
/** jsonb array. */
type JsonArr = ColumnType<unknown[], unknown[] | string | undefined, unknown[] | string>;

export type MembershipRole = 'owner' | 'admin' | 'member' | 'viewer';
export type ConnectorType =
  | 'upload'
  | 'gdrive'
  | 'sharepoint'
  | 'onedrive'
  | 'dropbox'
  | 'notion'
  | 'confluence';
export type ConnectorStatus = 'pending' | 'active' | 'disconnected' | 'error';
export type SyncStatus = 'queued' | 'running' | 'completed' | 'failed' | 'partial';
export type ProcessingStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'needs_review';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type ProcessingStage =
  | 'received'
  | 'extract'
  | 'normalize'
  | 'chunk'
  | 'embed'
  | 'store'
  | 'complete';

export interface OrganizationsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  settings: JsonCol;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: Nullable<string>;
  name: Nullable<string>;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface MembershipsTable {
  id: Generated<string>;
  organization_id: string;
  user_id: string;
  role: WithDefault<MembershipRole>;
  created_at: GenTimestamp;
}

export interface KnowledgeBaseTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  description: Nullable<string>;
  created_by: Nullable<string>;
  embedding_model: WithDefault<string>;
  chunk_config: JsonCol;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface FoldersTable {
  id: Generated<string>;
  organization_id: string;
  knowledge_base_id: string;
  parent_id: Nullable<string>;
  name: string;
  path: WithDefault<string>;
  origin: WithDefault<string>;
  source_connector_id: Nullable<string>;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface SourceConnectorsTable {
  id: Generated<string>;
  organization_id: string;
  type: ConnectorType;
  name: string;
  status: WithDefault<ConnectorStatus>;
  config: JsonCol;
  credentials_ref: Nullable<string>;
  created_by: Nullable<string>;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface RemoteObjectMappingTable {
  id: Generated<string>;
  organization_id: string;
  connector_id: string;
  remote_item_id: string;
  document_id: Nullable<string>;
  remote_path: Nullable<string>;
  etag: Nullable<string>;
  last_seen_sync_id: Nullable<string>;
  deleted_at: NullTimestamp;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface SyncJobsTable {
  id: Generated<string>;
  organization_id: string;
  connector_id: string;
  knowledge_base_id: string;
  selector: JsonCol;
  status: WithDefault<SyncStatus>;
  stats: JsonCol;
  cursor: Nullable<string>;
  error: Nullable<string>;
  started_at: NullTimestamp;
  finished_at: NullTimestamp;
  created_at: GenTimestamp;
}

export interface DocumentsTable {
  id: Generated<string>;
  organization_id: string;
  knowledge_base_id: string;
  folder_id: Nullable<string>;
  source_type: WithDefault<ConnectorType>;
  source_connector_id: Nullable<string>;
  source_item_id: Nullable<string>;
  source_url: Nullable<string>;
  file_name: string;
  mime_type: Nullable<string>;
  file_size: NullBigint;
  folder_path: Nullable<string>;
  owner_meta: JsonCol;
  permissions: JsonCol;
  external_created_at: NullTimestamp;
  external_modified_at: NullTimestamp;
  external_version: Nullable<string>;
  content_hash: Nullable<string>;
  storage_key: Nullable<string>;
  status: WithDefault<ProcessingStatus>;
  error_message: Nullable<string>;
  metadata: JsonCol;
  current_version_id: Nullable<string>;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface DocumentVersionsTable {
  id: Generated<string>;
  organization_id: string;
  document_id: string;
  version_no: number;
  storage_key: string;
  mime_type: Nullable<string>;
  file_size: NullBigint;
  external_version: Nullable<string>;
  content_hash: string;
  status: WithDefault<ProcessingStatus>;
  error_message: Nullable<string>;
  metadata: JsonCol;
  created_at: GenTimestamp;
}

export interface ProcessingJobsTable {
  id: Generated<string>;
  organization_id: string;
  document_id: string;
  version_id: string;
  queue_job_id: Nullable<string>;
  stage: WithDefault<ProcessingStage>;
  status: WithDefault<JobStatus>;
  attempts: WithDefault<number>;
  error: Nullable<string>;
  logs_ref: Nullable<string>;
  metrics: JsonCol;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface ChunksTable {
  id: Generated<string>;
  organization_id: string;
  knowledge_base_id: string;
  document_id: string;
  version_id: string;
  chunk_index: number;
  content: string;
  token_count: Nullable<number>;
  content_hash: Nullable<string>;
  page_number: Nullable<number>;
  sheet_name: Nullable<string>;
  slide_number: Nullable<number>;
  // pgvector; read/written via raw SQL in VectorStoreService.
  embedding: ColumnType<string | null, string | null | undefined, string | null>;
  embedding_model: Nullable<string>;
  metadata: JsonCol;
  created_at: GenTimestamp;
}

export interface QuerySessionsTable {
  id: Generated<string>;
  organization_id: string;
  knowledge_base_id: string;
  user_id: Nullable<string>;
  title: Nullable<string>;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface QueryMessagesTable {
  id: Generated<string>;
  organization_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations: JsonArr;
  attachments: JsonArr;
  created_at: GenTimestamp;
}

export interface RetrievalLogsTable {
  id: Generated<string>;
  organization_id: string;
  knowledge_base_id: string;
  user_id: Nullable<string>;
  session_id: Nullable<string>;
  source: WithDefault<string>;
  query: string;
  filters: JsonCol;
  retrieved: JsonArr;
  answer: Nullable<string>;
  citations: JsonArr;
  model: Nullable<string>;
  token_usage: JsonCol;
  latency_ms: Nullable<number>;
  created_at: GenTimestamp;
}

export interface ConnectorSecretsTable {
  connector_id: string;
  organization_id: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_version: WithDefault<number>;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface AuditLogsTable {
  id: Generated<string>;
  organization_id: string;
  actor_id: Nullable<string>;
  action: string;
  target_type: Nullable<string>;
  target_id: Nullable<string>;
  meta: JsonCol;
  created_at: GenTimestamp;
}

/** The Kysely database interface — inject `Kysely<DB>` into services. */
export type KnowledgeGapStatus = 'open' | 'resolved' | 'ignored';

export interface KnowledgeGapsTable {
  id: Generated<string>;
  organization_id: string;
  status: WithDefault<KnowledgeGapStatus>;
  title: string;
  // pgvector, serialized to/from a '[..]' string (read/written via raw SQL).
  centroid_embedding: ColumnType<string | null, string | null | undefined, string | null>;
  occurrence_count: WithDefault<number>;
  first_seen_at: GenTimestamp;
  last_seen_at: GenTimestamp;
  resolved_at: NullTimestamp;
  resolved_by: Nullable<string>;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface KnowledgeGapSignalsTable {
  id: Generated<string>;
  organization_id: string;
  gap_id: Nullable<string>;
  session_id: Nullable<string>;
  message_id: Nullable<string>;
  user_id: Nullable<string>;
  question: string;
  standalone_question: string;
  embedding: ColumnType<string | null, string | null | undefined, string | null>;
  retrieval_outcome: string;
  reason: string;
  top_score: Nullable<number>;
  weak_matches: JsonArr;
  created_at: GenTimestamp;
}

export type RagEvalRunStatus = 'queued' | 'running' | 'completed' | 'failed';
export type RagEvalRelevance = 'primary' | 'acceptable';

export interface RagEvalDatasetsTable {
  id: Generated<string>;
  organization_id: string;
  name: string;
  description: Nullable<string>;
  created_by: Nullable<string>;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface RagEvalCasesTable {
  id: Generated<string>;
  organization_id: string;
  dataset_id: string;
  question: string;
  expected_answerable: WithDefault<boolean>;
  expected_gap: WithDefault<boolean>;
  notes: Nullable<string>;
  created_by: Nullable<string>;
  created_at: GenTimestamp;
  updated_at: GenTimestamp;
}

export interface RagEvalCaseExpectedDocumentsTable {
  id: Generated<string>;
  organization_id: string;
  eval_case_id: string;
  document_id: string;
  relevance: WithDefault<RagEvalRelevance>;
  created_at: GenTimestamp;
}

export interface RagEvalRunsTable {
  id: Generated<string>;
  organization_id: string;
  dataset_id: string;
  status: WithDefault<RagEvalRunStatus>;
  started_by: Nullable<string>;
  config_snapshot: JsonCol;
  summary_metrics: JsonCol;
  total_cases: WithDefault<number>;
  succeeded_cases: WithDefault<number>;
  errored_cases: WithDefault<number>;
  error: Nullable<string>;
  started_at: NullTimestamp;
  completed_at: NullTimestamp;
  created_at: GenTimestamp;
}

export interface RagEvalResultsTable {
  id: Generated<string>;
  organization_id: string;
  run_id: string;
  eval_case_id: Nullable<string>;
  question: string;
  expected_answerable: boolean;
  expected_gap: boolean;
  expected_documents: JsonArr;
  retrieval: JsonCol;
  top_score: Nullable<number>;
  expected_document_found: Nullable<boolean>;
  expected_document_best_rank: Nullable<number>;
  actual_answerable: Nullable<boolean>;
  actual_gap: Nullable<boolean>;
  gap_reason: Nullable<string>;
  error: Nullable<string>;
  created_at: GenTimestamp;
}

export interface DB {
  organizations: OrganizationsTable;
  users: UsersTable;
  memberships: MembershipsTable;
  knowledge_base: KnowledgeBaseTable;
  folders: FoldersTable;
  source_connectors: SourceConnectorsTable;
  sync_jobs: SyncJobsTable;
  documents: DocumentsTable;
  document_versions: DocumentVersionsTable;
  processing_jobs: ProcessingJobsTable;
  chunks: ChunksTable;
  query_sessions: QuerySessionsTable;
  query_messages: QueryMessagesTable;
  retrieval_logs: RetrievalLogsTable;
  connector_secrets: ConnectorSecretsTable;
  remote_object_mapping: RemoteObjectMappingTable;
  audit_logs: AuditLogsTable;
  knowledge_gaps: KnowledgeGapsTable;
  knowledge_gap_signals: KnowledgeGapSignalsTable;
  rag_eval_datasets: RagEvalDatasetsTable;
  rag_eval_cases: RagEvalCasesTable;
  rag_eval_case_expected_documents: RagEvalCaseExpectedDocumentsTable;
  rag_eval_runs: RagEvalRunsTable;
  rag_eval_results: RagEvalResultsTable;
}
