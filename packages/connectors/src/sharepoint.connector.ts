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

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'offline_access Sites.Read.All Files.Read.All';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SUPPORTED = new Set(['application/pdf', 'text/plain', 'text/markdown', DOCX_MIME]);
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: DOCX_MIME,
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
};

interface MsTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface GraphList<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  eTag?: string;
  cTag?: string;
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  folder?: unknown;
  file?: { mimeType?: string };
  createdBy?: { user?: { email?: string; displayName?: string } };
  '@microsoft.graph.downloadUrl'?: string;
}

/** Encode/decode composite node ids so we can navigate site → drive → folder. */
const node = {
  site: (id: string) => `site:${id}`,
  drive: (id: string) => `drive:${id}`,
  item: (driveId: string, itemId: string) => `item:${driveId}:${itemId}`,
};

export class SharePointConnector implements SourceConnector {
  readonly type = 'sharepoint' as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tenant: string,
  ) {}

  private get authorizeUrl() {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize`;
  }
  private get tokenUrl() {
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`;
  }

  authUrl({ state, redirectUri }: OAuthStartParams): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: SCOPES,
      state,
    });
    return `${this.authorizeUrl}?${params.toString()}`;
  }

  async handleCallback({ code, redirectUri }: OAuthCallbackParams): Promise<ConnectorCredentials> {
    const tok = await fetchForm<MsTokenResponse>(this.tokenUrl, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: SCOPES,
    });
    return this.toCredentials(tok);
  }

  async refresh(credentials: ConnectorCredentials): Promise<ConnectorCredentials> {
    if (!credentials.refreshToken) throw new Error('No refresh token available');
    const tok = await fetchForm<MsTokenResponse>(this.tokenUrl, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
      scope: SCOPES,
    });
    return this.toCredentials({ ...tok, refresh_token: tok.refresh_token ?? credentials.refreshToken });
  }

  async listRoots(ctx: ConnectorContext): Promise<RemoteNode[]> {
    const res = await fetchJson<GraphList<{ id: string; displayName?: string; name?: string }>>(
      `${GRAPH}/sites?search=*`,
      this.headers(ctx),
    );
    return res.value.map((s) => ({ id: node.site(s.id), name: s.displayName ?? s.name ?? s.id, type: 'site' as const }));
  }

  async listChildren(ctx: ConnectorContext, nodeId: string): Promise<RemoteNode[]> {
    const [kind, a, b] = nodeId.split(':');
    if (kind === 'site') {
      const res = await fetchJson<GraphList<{ id: string; name?: string }>>(
        `${GRAPH}/sites/${a}/drives`,
        this.headers(ctx),
      );
      return res.value.map((d) => ({ id: node.drive(d.id), name: d.name ?? 'Documents', type: 'drive' as const, parentId: nodeId }));
    }
    if (kind === 'drive') {
      const items = await this.children(ctx, a!, 'root');
      return foldersAsNodes(items, a!, nodeId);
    }
    if (kind === 'item') {
      const items = await this.children(ctx, a!, b!);
      return foldersAsNodes(items, a!, nodeId);
    }
    throw new Error(`Unknown node id: ${nodeId}`);
  }

  async listFiles(
    ctx: ConnectorContext,
    selector: Record<string, unknown>,
    _cursor?: string | null,
  ): Promise<{ files: RemoteFile[]; nextCursor: string | null }> {
    const nodes = (selector.folderIds as string[] | undefined) ?? [];
    const files: RemoteFile[] = [];

    const walk = async (driveId: string, itemId: string): Promise<void> => {
      const items = await this.children(ctx, driveId, itemId);
      for (const it of items) {
        if (it.folder) {
          await walk(driveId, it.id);
        } else {
          const mime = resolveMime(it);
          if (mime) files.push(this.toRemoteFile(driveId, it, mime));
        }
      }
    };

    for (const n of nodes) {
      const [kind, a, b] = n.split(':');
      if (kind === 'drive') await walk(a!, 'root');
      else if (kind === 'item') await walk(a!, b!);
    }
    return { files, nextCursor: null };
  }

  async fetchFile(ctx: ConnectorContext, file: RemoteFile): Promise<FetchedFile> {
    const [driveId, itemId] = file.sourceItemId.split(':');
    const stream = await fetchStream(`${GRAPH}/drives/${driveId}/items/${itemId}/content`, this.headers(ctx));
    return { stream, mimeType: file.mimeType, sizeBytes: file.sizeBytes };
  }

  private async children(ctx: ConnectorContext, driveId: string, itemId: string): Promise<DriveItem[]> {
    const out: DriveItem[] = [];
    let url: string | undefined =
      `${GRAPH}/drives/${driveId}/items/${itemId}/children?$top=200&$select=id,name,size,eTag,cTag,webUrl,createdDateTime,lastModifiedDateTime,folder,file,createdBy,@microsoft.graph.downloadUrl`;
    while (url) {
      const res: GraphList<DriveItem> = await fetchJson<GraphList<DriveItem>>(url, this.headers(ctx));
      out.push(...res.value);
      url = res['@odata.nextLink'];
    }
    return out;
  }

  private toRemoteFile(driveId: string, it: DriveItem, mime: string): RemoteFile {
    return {
      sourceItemId: `${driveId}:${it.id}`,
      name: it.name,
      mimeType: mime,
      sizeBytes: it.size,
      webUrl: it.webUrl,
      createdAt: it.createdDateTime,
      modifiedAt: it.lastModifiedDateTime,
      externalVersion: it.cTag ?? it.eTag,
      owner: it.createdBy?.user ? { email: it.createdBy.user.email, name: it.createdBy.user.displayName } : undefined,
    };
  }

  private headers(ctx: ConnectorContext): RequestInit {
    return { headers: { authorization: `Bearer ${ctx.credentials.accessToken}` } };
  }

  private toCredentials(tok: MsTokenResponse): ConnectorCredentials {
    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    };
  }
}

function foldersAsNodes(items: DriveItem[], driveId: string, parentId: string): RemoteNode[] {
  return items
    .filter((it) => it.folder)
    .map((it) => ({ id: node.item(driveId, it.id), name: it.name, type: 'folder' as const, parentId }));
}

function resolveMime(it: DriveItem): string | null {
  const provided = it.file?.mimeType;
  if (provided && SUPPORTED.has(provided)) return provided;
  const ext = it.name.split('.').pop()?.toLowerCase() ?? '';
  const byExt = EXT_MIME[ext];
  return byExt && SUPPORTED.has(byExt) ? byExt : null;
}
