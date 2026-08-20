import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { getConnector, IMPLEMENTED_CONNECTORS, signState, verifyState } from '@kb/connectors';
import {
  CONTRACT_VERSION,
  type AuthUser,
  type ConnectorContext,
  type ConnectorCredentials,
  type ConnectorType,
  type RemoteNode,
  type SourceConnector,
  type SyncJobV1,
} from '@kb/shared';
import type { Selectable } from 'kysely';
import type { SourceConnectorsTable } from '@kb/db';
import { DatabaseService } from '../database/database.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { SpacesService } from '../spaces/spaces.service.js';
import { ConnectorSecretsService } from './connector-secrets.service.js';
import { SyncQueueService } from './sync-queue.service.js';

const nowSeconds = () => Math.floor(Date.now() / 1000);

@Injectable()
export class ConnectorsService {
  private readonly logger = new Logger(ConnectorsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly config: AppConfigService,
    private readonly spaces: SpacesService,
    private readonly secrets: ConnectorSecretsService,
    private readonly syncQueue: SyncQueueService,
  ) {}

  private get stateSecret(): string {
    return this.config.env.OAUTH_STATE_SECRET ?? this.config.env.JWT_SECRET;
  }

  private redirectUri(type: string): string {
    return `${this.config.env.API_PUBLIC_URL}/connectors/${type}/callback`;
  }

  private assertImplemented(type: string): asserts type is ConnectorType {
    if (!IMPLEMENTED_CONNECTORS.includes(type as ConnectorType)) {
      throw new BadRequestException(`Connector type not supported: ${type}`);
    }
  }

  /** Step 1 of OAuth: produce the provider consent URL. */
  async getAuthUrl(
    user: AuthUser,
    type: string,
    opts: { spaceId?: string; name?: string },
  ): Promise<{ url: string }> {
    this.assertImplemented(type);
    if (opts.spaceId) await this.spaces.requireSpace(user.organizationId, opts.spaceId);
    const connector = getConnector(type, process.env);
    const state = signState(
      this.stateSecret,
      { orgId: user.organizationId, userId: user.id, type, spaceId: opts.spaceId, name: opts.name },
      nowSeconds(),
    );
    return { url: connector.authUrl({ state, redirectUri: this.redirectUri(type) }) };
  }

  /** Step 2 of OAuth: exchange code, persist connector + encrypted secret. Returns web redirect. */
  async handleCallback(type: string, code: string, state: string): Promise<string> {
    this.assertImplemented(type);
    const payload = verifyState(this.stateSecret, state, nowSeconds());
    if (payload.type !== type) throw new BadRequestException('State/type mismatch');

    const connector = getConnector(type, process.env);
    const credentials = await connector.handleCallback({ code, redirectUri: this.redirectUri(type) });

    // The OAuth callback is unauthenticated (Google's redirect), so no tenant is
    // bound by the interceptor. Set it from the verified state so RLS-protected
    // writes (source_connectors, connector_secrets) pass their WITH CHECK.
    const connectorId = await this.database.runWithTenant(payload.orgId, async () => {
      const row = await this.database.db
        .insertInto('source_connectors')
        .values({
          organization_id: payload.orgId,
          type,
          name: payload.name ?? `${type} connection`,
          status: 'active',
          config: JSON.stringify({ spaceId: payload.spaceId ?? null }),
          created_by: payload.userId,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      await this.secrets.store(row.id, payload.orgId, credentials);
      return row.id;
    });

    this.logger.log({ connectorId, type }, 'connector connected');
    return `${this.config.env.WEB_PUBLIC_URL}/connectors/${connectorId}`;
  }

  async list(user: AuthUser) {
    return this.database.db
      .selectFrom('source_connectors')
      .select(['id', 'type', 'name', 'status', 'config', 'created_at as createdAt'])
      .where('organization_id', '=', user.organizationId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async browse(user: AuthUser, connectorId: string, nodeId?: string): Promise<RemoteNode[]> {
    const row = await this.requireConnector(user.organizationId, connectorId);
    const { connector, ctx } = await this.contextFor(row);
    return nodeId ? connector.listChildren(ctx, nodeId) : connector.listRoots(ctx);
  }

  async sync(
    user: AuthUser,
    connectorId: string,
    input: { selector: Record<string, unknown>; spaceId?: string },
  ) {
    const row = await this.requireConnector(user.organizationId, connectorId);
    const configSpace = (row.config as { spaceId?: string }).spaceId ?? undefined;
    const spaceId = input.spaceId ?? configSpace;
    if (!spaceId) throw new BadRequestException('No target space for this sync');
    await this.spaces.requireSpace(user.organizationId, spaceId);

    const job = await this.database.db
      .insertInto('sync_jobs')
      .values({
        organization_id: user.organizationId,
        connector_id: connectorId,
        knowledge_base_id: spaceId,
        selector: JSON.stringify(input.selector ?? {}),
        status: 'queued',
      })
      .returning(['id', 'status', 'created_at as createdAt'])
      .executeTakeFirstOrThrow();

    const payload: SyncJobV1 = {
      contractVersion: CONTRACT_VERSION,
      jobType: 'connector_sync',
      organizationId: user.organizationId,
      connectorId,
      spaceId,
      syncJobId: job.id,
      selector: input.selector ?? {},
      cursor: null,
    };
    await this.syncQueue.enqueueSync(payload);
    return job;
  }

  async history(user: AuthUser, connectorId: string) {
    await this.requireConnector(user.organizationId, connectorId);
    return this.database.db
      .selectFrom('sync_jobs')
      .select(['id', 'status', 'stats', 'error', 'started_at as startedAt', 'finished_at as finishedAt', 'created_at as createdAt'])
      .where('organization_id', '=', user.organizationId)
      .where('connector_id', '=', connectorId)
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute();
  }

  async remove(user: AuthUser, connectorId: string): Promise<void> {
    await this.requireConnector(user.organizationId, connectorId);
    await this.database.db
      .deleteFrom('source_connectors')
      .where('id', '=', connectorId)
      .where('organization_id', '=', user.organizationId)
      .execute();
  }

  private async requireConnector(
    organizationId: string,
    connectorId: string,
  ): Promise<Selectable<SourceConnectorsTable>> {
    const row = await this.database.db
      .selectFrom('source_connectors')
      .selectAll()
      .where('id', '=', connectorId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();
    if (!row) throw new NotFoundException('Connector not found');
    return row;
  }

  /** Build a connector + ctx with fresh (refreshed if needed) credentials. */
  private async contextFor(
    row: Selectable<SourceConnectorsTable>,
  ): Promise<{ connector: SourceConnector; ctx: ConnectorContext }> {
    const connector = getConnector(row.type, process.env);
    let credentials = await this.secrets.get(row.id);
    credentials = await this.ensureFresh(connector, row.id, row.organization_id, credentials);
    const ctx: ConnectorContext = {
      organizationId: row.organization_id,
      connectorId: row.id,
      config: (row.config as Record<string, unknown>) ?? {},
      credentials,
    };
    return { connector, ctx };
  }

  private async ensureFresh(
    connector: SourceConnector,
    connectorId: string,
    organizationId: string,
    credentials: ConnectorCredentials,
  ): Promise<ConnectorCredentials> {
    const expiresAt = credentials.expiresAt ? new Date(credentials.expiresAt).getTime() : 0;
    const nearExpiry = expiresAt > 0 && expiresAt < Date.now() + 60_000;
    if (nearExpiry && connector.refresh) {
      const refreshed = await connector.refresh(credentials);
      await this.secrets.store(connectorId, organizationId, refreshed);
      return refreshed;
    }
    return credentials;
  }
}
