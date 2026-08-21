import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import { createDb, type DB } from '@kb/db';
import { CONTRACT_VERSION, QUEUE, type SyncJobV1 } from '@kb/shared';
import { AppConfigService } from '../config/app-config.service.js';
import { DatabaseService } from '../database/database.service.js';

/**
 * Periodically re-syncs connected sources so new/changed files in Drive/SharePoint
 * flow into the KB without the user clicking "Sync". Each tick re-runs the last
 * selector a connector was synced with; the sync itself is idempotent (diffs by
 * version/hash), so re-runs only ingest what actually changed.
 *
 * The scan is cross-tenant, so it uses the admin connection (RLS would hide other
 * orgs' connectors under the runtime role). All WRITES go through
 * runWithTenant(org) so tenant scoping/RLS still holds for the enqueue.
 */
@Injectable()
export class AutoSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoSyncScheduler.name);
  private admin?: Kysely<DB>;
  private connection?: Redis;
  private queue?: Queue;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly database: DatabaseService,
  ) {}

  onModuleInit(): void {
    if (!this.config.env.AUTO_SYNC_ENABLED) {
      this.logger.log('auto-sync disabled (AUTO_SYNC_ENABLED=false)');
      return;
    }
    this.admin = createDb({ connectionString: this.config.env.DATABASE_URL });
    this.connection = new IORedis(this.config.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE.Sync, { connection: this.connection, prefix: this.config.env.QUEUE_PREFIX });

    const intervalMs = this.config.env.AUTO_SYNC_INTERVAL_MINUTES * 60_000;
    // Kick off shortly after boot, then on the interval.
    this.timer = setInterval(() => void this.tick(), intervalMs);
    setTimeout(() => void this.tick(), 30_000).unref?.();
    this.timer.unref?.();
    this.logger.log(`auto-sync every ${this.config.env.AUTO_SYNC_INTERVAL_MINUTES}m`);
  }

  private async tick(): Promise<void> {
    if (this.running || !this.admin || !this.queue) return;
    this.running = true;
    try {
      const due = await this.findDue();
      if (due.length === 0) return;
      this.logger.log(`auto-sync scanning ${due.length} connector(s)`);
      for (const c of due) {
        try {
          await this.enqueue(c);
        } catch (err) {
          this.logger.error({ connectorId: c.id, err: msg(err) }, 'auto-sync enqueue failed');
        }
      }
    } catch (err) {
      this.logger.error({ err: msg(err) }, 'auto-sync tick failed');
    } finally {
      this.running = false;
    }
  }

  /**
   * Active connectors that opted into auto-sync, have been synced at least once
   * (so we know a selector + target), and have no in-flight sync and no completed
   * sync within the interval window.
   */
  private async findDue(): Promise<DueConnector[]> {
    const windowMs = this.config.env.AUTO_SYNC_INTERVAL_MINUTES * 60_000;
    const cutoff = new Date(Date.now() - windowMs * 0.9);
    const rows = await this.admin!.selectFrom('source_connectors as sc')
      .select(['sc.id as id', 'sc.organization_id as organizationId', 'sc.config as config'])
      .where('sc.status', '=', 'active')
      // opted-in (default on) and previously synced (has a stored selector + space)
      .where(sql<boolean>`coalesce(sc.config->>'autoSync', 'true') <> 'false'`)
      .where(sql<boolean>`sc.config ? 'lastSelector'`)
      .where(sql<boolean>`sc.config ? 'spaceId'`)
      // nothing queued/running for this connector right now
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('sync_jobs as j')
              .select('j.id')
              .whereRef('j.connector_id', '=', 'sc.id')
              .where('j.status', 'in', ['queued', 'running']),
          ),
        ),
      )
      // no sync completed within the window (avoids double-runs)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('sync_jobs as j2')
              .select('j2.id')
              .whereRef('j2.connector_id', '=', 'sc.id')
              .where('j2.finished_at', '>', cutoff),
          ),
        ),
      )
      .execute();

    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      config: (r.config as ConnectorConfig) ?? {},
    }));
  }

  private async enqueue(c: DueConnector): Promise<void> {
    const spaceId = c.config.spaceId;
    const selector = c.config.lastSelector ?? {};
    if (!spaceId) return;

    await this.database.runWithTenant(c.organizationId, async () => {
      const job = await this.database.db
        .insertInto('sync_jobs')
        .values({
          organization_id: c.organizationId,
          connector_id: c.id,
          knowledge_base_id: spaceId,
          selector: JSON.stringify(selector),
          status: 'queued',
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      const payload: SyncJobV1 = {
        contractVersion: CONTRACT_VERSION,
        jobType: 'connector_sync',
        organizationId: c.organizationId,
        connectorId: c.id,
        spaceId,
        syncJobId: job.id,
        selector,
        cursor: null,
        // Auto-sync re-runs the canonical selector, so an item missing from the
        // full listing genuinely means "deleted at source".
        reconcileDeletes: true,
      };
      await this.queue!.add(payload.jobType, payload, {
        jobId: payload.syncJobId,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      });
      this.logger.log({ connectorId: c.id, syncJobId: job.id }, 'auto-sync enqueued');
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.queue?.close();
    await this.connection?.quit();
    await this.admin?.destroy();
  }
}

interface ConnectorConfig {
  spaceId?: string;
  autoSync?: boolean;
  lastSelector?: Record<string, unknown>;
}
interface DueConnector {
  id: string;
  organizationId: string;
  config: ConnectorConfig;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
