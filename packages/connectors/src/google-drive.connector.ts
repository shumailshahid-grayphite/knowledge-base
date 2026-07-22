import type {
  ConnectorContext,
  ConnectorCredentials,
  FetchedFile,
  OAuthCallbackParams,
  OAuthStartParams,
  RemoteFile,
  RemoteNode,
  SourceConnector,
} from '@kb/shared';
import { fetchForm, fetchJson, fetchStream } from './http.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const GDOC_MIME = 'application/vnd.google-apps.document';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const DIRECT_SUPPORTED = new Set(['application/pdf', 'text/plain', 'text/markdown', DOCX_MIME]);

interface DriveTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  md5Checksum?: string;
  version?: string;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
  owners?: Array<{ emailAddress?: string; displayName?: string }>;
}

interface DriveListResponse {
  files: DriveFile[];
  nextPageToken?: string;
}

export class GoogleDriveConnector implements SourceConnector {
  readonly type = 'gdrive' as const;

  constructor(private readonly clientId: string, private readonly clientSecret: string) {}

  authUrl({ state, redirectUri }: OAuthStartParams): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async handleCallback({ code, redirectUri }: OAuthCallbackParams): Promise<ConnectorCredentials> {
    const tok = await fetchForm<DriveTokenResponse>(TOKEN_URL, {
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    return this.toCredentials(tok);
  }

  async refresh(credentials: ConnectorCredentials): Promise<ConnectorCredentials> {
    if (!credentials.refreshToken) throw new Error('No refresh token available');
    const tok = await fetchForm<DriveTokenResponse>(TOKEN_URL, {
      refresh_token: credentials.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
    });
    // Google may omit refresh_token on refresh; keep the existing one.
    return this.toCredentials({ ...tok, refresh_token: tok.refresh_token ?? credentials.refreshToken });
  }

  async listRoots(): Promise<RemoteNode[]> {
    return [{ id: 'root', name: 'My Drive', type: 'drive' }];
  }

  async listChildren(ctx: ConnectorContext, nodeId: string): Promise<RemoteNode[]> {
    const folders: RemoteNode[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${nodeId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: 'nextPageToken, files(id, name)',
        pageSize: '200',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await fetchJson<DriveListResponse>(`${API}/files?${params}`, this.authHeaders(ctx));
      for (const f of res.files) folders.push({ id: f.id, name: f.name, type: 'folder', parentId: nodeId });
      pageToken = res.nextPageToken;
    } while (pageToken);
    return folders;
  }

  async listFiles(
    ctx: ConnectorContext,
    selector: Record<string, unknown>,
    _cursor?: string | null,
  ): Promise<{ files: RemoteFile[]; nextCursor: string | null }> {
    const folderIds = (selector.folderIds as string[] | undefined) ?? ['root'];
    const files: RemoteFile[] = [];
    const visited = new Set<string>();

    // `path` accumulates the folder path relative to the selected root, so the
    // structure mirrors into KB folders. Root ('/') means the KB root.
    const walk = async (folderId: string, path: string): Promise<void> => {
      if (visited.has(folderId)) return;
      visited.add(folderId);
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          q: `'${folderId}' in parents and trashed = false`,
          fields:
            'nextPageToken, files(id, name, mimeType, size, md5Checksum, version, modifiedTime, createdTime, webViewLink, owners(emailAddress,displayName))',
          pageSize: '200',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const res = await fetchJson<DriveListResponse>(`${API}/files?${params}`, this.authHeaders(ctx));
        for (const f of res.files) {
          if (f.mimeType === FOLDER_MIME) {
            await walk(f.id, `${path}${f.name}/`); // recurse into subfolders
          } else if (DIRECT_SUPPORTED.has(f.mimeType) || f.mimeType === GDOC_MIME) {
            files.push(this.toRemoteFile(f, path === '/' ? undefined : path));
          }
        }
        pageToken = res.nextPageToken;
      } while (pageToken);
    };

    // Each selected folder becomes a top-level mirror root (its own name); the
    // drive root ('root') mirrors its children directly under the KB root.
    for (const id of folderIds) {
      const rootPath = id === 'root' ? '/' : `/${await this.folderName(ctx, id)}/`;
      await walk(id, rootPath);
    }
    return { files, nextCursor: null };
  }

  private async folderName(ctx: ConnectorContext, id: string): Promise<string> {
    const res = await fetchJson<{ name?: string }>(`${API}/files/${id}?fields=name`, this.authHeaders(ctx));
    return res.name ?? id;
  }

  async fetchFile(ctx: ConnectorContext, file: RemoteFile): Promise<FetchedFile> {
    const isGoogleDoc = file.mimeType === GDOC_MIME;
    const url = isGoogleDoc
      ? `${API}/files/${file.sourceItemId}/export?mimeType=${encodeURIComponent(DOCX_MIME)}`
      : `${API}/files/${file.sourceItemId}?alt=media`;
    const stream = await fetchStream(url, this.authHeaders(ctx));
    return { stream, mimeType: isGoogleDoc ? DOCX_MIME : file.mimeType, sizeBytes: file.sizeBytes };
  }

  private toRemoteFile(f: DriveFile, folderPath?: string): RemoteFile {
    // Google Docs export to .docx; reflect that in name/mime for downstream processing.
    const isGoogleDoc = f.mimeType === GDOC_MIME;
    return {
      sourceItemId: f.id,
      name: isGoogleDoc ? `${f.name}.docx` : f.name,
      mimeType: isGoogleDoc ? DOCX_MIME : f.mimeType,
      sizeBytes: f.size ? Number(f.size) : undefined,
      webUrl: f.webViewLink,
      folderPath,
      createdAt: f.createdTime,
      modifiedAt: f.modifiedTime,
      externalVersion: f.md5Checksum ?? f.version ?? f.modifiedTime,
      owner: f.owners?.[0] ? { email: f.owners[0].emailAddress, name: f.owners[0].displayName } : undefined,
    };
  }

  private authHeaders(ctx: ConnectorContext): RequestInit {
    return { headers: { authorization: `Bearer ${ctx.credentials.accessToken}` } };
  }

  private toCredentials(tok: DriveTokenResponse): ConnectorCredentials {
    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    };
  }
}
