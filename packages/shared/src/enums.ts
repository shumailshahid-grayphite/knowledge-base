/**
 * Mirrors the Postgres enum types in packages/db. These are the shared status
 * vocabulary across API, worker, and DB — keep in lockstep with docs/CONTRACTS.md.
 */

export const MembershipRole = {
  Owner: 'owner',
  Admin: 'admin',
  Member: 'member',
  Viewer: 'viewer',
} as const;
export type MembershipRole = (typeof MembershipRole)[keyof typeof MembershipRole];

export const ConnectorType = {
  Upload: 'upload',
  GDrive: 'gdrive',
  SharePoint: 'sharepoint',
  OneDrive: 'onedrive',
  Dropbox: 'dropbox',
  Notion: 'notion',
  Confluence: 'confluence',
} as const;
export type ConnectorType = (typeof ConnectorType)[keyof typeof ConnectorType];
/** documents.source_type reuses the connector_type enum. */
export type SourceType = ConnectorType;

export const ConnectorStatus = {
  Pending: 'pending',
  Active: 'active',
  Disconnected: 'disconnected',
  Error: 'error',
} as const;
export type ConnectorStatus = (typeof ConnectorStatus)[keyof typeof ConnectorStatus];

export const SyncStatus = {
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Partial: 'partial',
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

export const ProcessingStatus = {
  Uploaded: 'uploaded',
  Queued: 'queued',
  Processing: 'processing',
  Completed: 'completed',
  Failed: 'failed',
  NeedsReview: 'needs_review',
} as const;
export type ProcessingStatus = (typeof ProcessingStatus)[keyof typeof ProcessingStatus];

export const JobStatus = {
  Queued: 'queued',
  Processing: 'processing',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const ProcessingStage = {
  Received: 'received',
  Extract: 'extract',
  Normalize: 'normalize',
  Chunk: 'chunk',
  Embed: 'embed',
  Store: 'store',
  Complete: 'complete',
} as const;
export type ProcessingStage = (typeof ProcessingStage)[keyof typeof ProcessingStage];

/** MIME types supported by the MVP pipeline. */
export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'text/plain',
  'text/markdown',
] as const;
