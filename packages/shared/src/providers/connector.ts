/**
 * Source connector abstraction. ONE interface, many implementations
 * (gdrive, sharepoint, ...). Core rule: connectors PRODUCE FILES; they never parse.
 * The same downstream ingest pipeline handles every source.
 */
import type { Readable } from 'node:stream';
import type { ConnectorType } from '../enums.js';

/** Opaque, decrypted credentials handed to a connector at call time. */
export interface ConnectorCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  [k: string]: unknown;
}

export interface ConnectorContext {
  organizationId: string;
  connectorId: string;
  config: Record<string, unknown>;
  credentials: ConnectorCredentials;
}

/** A browsable node: a site, drive, or folder. */
export interface RemoteNode {
  id: string;
  name: string;
  type: 'site' | 'drive' | 'folder';
  parentId?: string;
}

/** A syncable file discovered under a selection. */
export interface RemoteFile {
  sourceItemId: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  webUrl?: string;
  folderPath?: string;
  createdAt?: string;
  modifiedAt?: string;
  /** ETag / version / checksum used for change detection. */
  externalVersion?: string;
  owner?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
}

export interface FetchedFile {
  stream: Readable;
  mimeType: string;
  sizeBytes?: number;
}

export interface OAuthStartParams {
  state: string;
  redirectUri: string;
}

export interface OAuthCallbackParams {
  code: string;
  redirectUri: string;
}

export interface SourceConnector {
  readonly type: ConnectorType;

  /** Begin OAuth: URL to redirect the user to. */
  authUrl(params: OAuthStartParams): string;

  /** Exchange the OAuth code for credentials (to be stored via secret ref). */
  handleCallback(params: OAuthCallbackParams): Promise<ConnectorCredentials>;

  /** Refresh an expiring token. Returns updated credentials (keeping refresh token). */
  refresh?(credentials: ConnectorCredentials): Promise<ConnectorCredentials>;

  /** Top-level browsable nodes (sites / drives / root folders). */
  listRoots(ctx: ConnectorContext): Promise<RemoteNode[]>;

  /** Children of a node (for folder browsing). */
  listChildren(ctx: ConnectorContext, nodeId: string): Promise<RemoteNode[]>;

  /** All supported files under a selection (optionally incremental via cursor). */
  listFiles(
    ctx: ConnectorContext,
    selector: Record<string, unknown>,
    cursor?: string | null,
  ): Promise<{ files: RemoteFile[]; nextCursor: string | null }>;

  /** Download/export a file's bytes for the ingest pipeline. */
  fetchFile(ctx: ConnectorContext, file: RemoteFile): Promise<FetchedFile>;
}
