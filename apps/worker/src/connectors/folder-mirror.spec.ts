import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import type {
  ConnectorContext,
  FetchedFile,
  RemoteFile,
  SourceConnector,
  StorageProvider,
  SyncJobV1,
} from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FolderMirrorService } from './folder-mirror.service.js';
import { ConnectorIngestionService } from './connector-ingestion.service.js';
import type { ConnectorSecretsService } from './connector-secrets.service.js';
import type { IngestProducerService } from './ingest-producer.service.js';

// Integration test against the local Postgres. Skips when no DB is configured
// (e.g. CI without a database) so the unit suite stays green.
const HAS_DB = !!(process.env.APP_DATABASE_URL || process.env.DATABASE_URL);
const ORG = '00000000-0000-0000-0000-000000000001';

/** Deterministic connector: returns whatever files the test sets, no network. */
class FakeConnector implements SourceConnector {
  readonly type = 'gdrive' as const;
  files: RemoteFile[] = [];
  authUrl() { return ''; }
  async handleCallback() { return { accessToken: 'x' }; }
  async listRoots() { return []; }
  async listChildren() { return []; }
  async listFiles() { return { files: this.files, nextCursor: null }; }
  async fetchFile(_ctx: ConnectorContext, file: RemoteFile): Promise<FetchedFile> {
    return { stream: Readable.from(Buffer.from(`content of ${file.name}`)), mimeType: file.mimeType };
  }
}

const storageStub = { put: async (key: string) => key } as unknown as StorageProvider;
const secretsStub = { get: async () => ({ accessToken: 'x' }) } as unknown as ConnectorSecretsService;

describe.skipIf(!HAS_DB)('connector folder mirroring', () => {
  let db: DatabaseService;
  let service: ConnectorIngestionService;
  const fake = new FakeConnector();
  const enqueued: unknown[] = [];
  let kbId: string;
  let connectorId: string;
  let syncJobId: string;

  const run = () =>
    db.runWithTenant(ORG, () =>
      service.runSync({
        contractVersion: 1,
        jobType: 'connector_sync',
        organizationId: ORG,
        connectorId,
        spaceId: kbId,
        syncJobId,
        selector: {},
        cursor: null,
      } satisfies SyncJobV1),
    );

  beforeAll(async () => {
    db = new DatabaseService(new AppConfigService());
    const producerStub = {
      enqueueIngest: async (p: unknown) => {
        enqueued.push(p);
        return 'job';
      },
    } as unknown as IngestProducerService;
    service = new ConnectorIngestionService(
      db,
      storageStub,
      secretsStub,
      producerStub,
      new FolderMirrorService(db),
      () => fake,
    );

    await db.runWithTenant(ORG, async () => {
      // Dedicated empty KB so mirrored folders don't collide with existing ones.
      const kb = await db.db
        .insertInto('knowledge_base')
        .values({ organization_id: ORG, name: `test-mirror-${syncJobId ?? 'kb'}-${ORG.slice(0, 8)}` })
        .returning('id')
        .executeTakeFirstOrThrow();
      kbId = kb.id;
      const c = await db.db
        .insertInto('source_connectors')
        .values({ organization_id: ORG, type: 'gdrive', name: 'Test Drive', config: JSON.stringify({}) })
        .returning('id')
        .executeTakeFirstOrThrow();
      connectorId = c.id;
      const j = await db.db
        .insertInto('sync_jobs')
        .values({ organization_id: ORG, connector_id: connectorId, knowledge_base_id: kbId, selector: JSON.stringify({}) })
        .returning('id')
        .executeTakeFirstOrThrow();
      syncJobId = j.id;
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.runWithTenant(ORG, async () => {
      // Deleting the KB cascades its folders/docs/sync_jobs; deleting the
      // connector cascades its remote_object_mapping rows.
      await db.db.deleteFrom('knowledge_base').where('id', '=', kbId).execute();
      await db.db.deleteFrom('source_connectors').where('id', '=', connectorId).execute();
    });
    await db.onModuleDestroy();
  });

  it('mirrors nested source folders and files them into the KB tree', async () => {
    fake.files = [
      { sourceItemId: 'g1', name: 'policy.txt', mimeType: 'text/plain', folderPath: '/HR/2026/', externalVersion: 'v1' },
      { sourceItemId: 'g2', name: 'budget.txt', mimeType: 'text/plain', folderPath: '/Finance/', externalVersion: 'v1' },
    ];
    await run();

    await db.runWithTenant(ORG, async () => {
      const folders = await db.db
        .selectFrom('folders')
        .select(['path', 'origin'])
        .where('knowledge_base_id', '=', kbId)
        .execute();
      expect(folders.map((f) => f.path).sort()).toEqual(['/Finance/', '/HR/', '/HR/2026/']);
      expect(folders.every((f) => f.origin === 'connector')).toBe(true);

      const g1 = await db.db
        .selectFrom('documents as d')
        .innerJoin('folders as f', 'f.id', 'd.folder_id')
        .select(['f.path as folderPath'])
        .where('d.source_item_id', '=', 'g1')
        .executeTakeFirstOrThrow();
      expect(g1.folderPath).toBe('/HR/2026/');

      const mappings = await db.db
        .selectFrom('remote_object_mapping')
        .select(['remote_item_id', 'last_seen_sync_id'])
        .where('connector_id', '=', connectorId)
        .execute();
      expect(mappings.map((m) => m.remote_item_id).sort()).toEqual(['g1', 'g2']);
      expect(mappings.every((m) => m.last_seen_sync_id === syncJobId)).toBe(true);
    });

    expect(enqueued.length).toBe(2);
  });

  it('is idempotent on re-sync (no duplicate folders, files skipped)', async () => {
    enqueued.length = 0;
    await run();
    await db.runWithTenant(ORG, async () => {
      const rows = await db.db
        .selectFrom('folders')
        .select(['path'])
        .where('knowledge_base_id', '=', kbId)
        .execute();
      expect(rows.length).toBe(3); // unchanged
    });
    expect(enqueued.length).toBe(0); // version-tag fast path -> skipped, no re-ingest
  });

  it('reconciles a move without re-ingesting (folder_id updated)', async () => {
    fake.files = [
      { sourceItemId: 'g1', name: 'policy.txt', mimeType: 'text/plain', folderPath: '/HR/2027/', externalVersion: 'v1' },
    ];
    await run();
    await db.runWithTenant(ORG, async () => {
      const g1 = await db.db
        .selectFrom('documents as d')
        .innerJoin('folders as f', 'f.id', 'd.folder_id')
        .select(['f.path as folderPath'])
        .where('d.source_item_id', '=', 'g1')
        .executeTakeFirstOrThrow();
      expect(g1.folderPath).toBe('/HR/2027/');
    });
  });
});
