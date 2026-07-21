import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createDb, type DB } from '@kb/db';
import { sql, type Kysely } from 'kysely';
import { AppConfigService } from '../config/app-config.service.js';

interface TenantStore {
  db: Kysely<DB>;
}

/**
 * Worker DB access. The worker processes jobs across tenants, so every job runs
 * inside `runWithTenant()` which pins a connection and sets `app.current_org`
 * (read by Postgres RLS). `get db()` returns the job-scoped connection, so all
 * `this.database.db` call sites are tenant-scoped automatically.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Kysely<DB>;
  private readonly als = new AsyncLocalStorage<TenantStore>();

  constructor(config: AppConfigService) {
    this.pool = createDb({
      connectionString: config.env.APP_DATABASE_URL ?? config.env.DATABASE_URL,
    });
  }

  get db(): Kysely<DB> {
    return this.als.getStore()?.db ?? this.pool;
  }

  get root(): Kysely<DB> {
    return this.pool;
  }

  async runWithTenant<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
    return this.pool.connection().execute(async (conn) => {
      await sql`select set_config('app.current_org', ${organizationId}, false)`.execute(conn);
      try {
        return await this.als.run({ db: conn }, fn);
      } finally {
        await sql`select set_config('app.current_org', '', false)`.execute(conn).catch(() => {});
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.destroy();
  }
}
