import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createDb, type DB } from '@kb/db';
import { sql, type Kysely } from 'kysely';
import { AppConfigService } from '../config/app-config.service.js';

interface TenantStore {
  /** A single connection pinned for the request, with app.current_org set. */
  db: Kysely<DB>;
}

/**
 * Holds the pooled Kysely instance for the API process.
 *
 * Tenant isolation is defense-in-depth: the app scopes every query by
 * organization_id AND Postgres RLS enforces it. RLS reads `app.current_org`
 * from the connection, so each request runs inside `runWithTenant()`, which
 * pins a connection, sets the GUC, and exposes that connection via AsyncLocal
 * storage. `get db()` returns the request-scoped connection when present, so
 * existing `this.database.db` call sites become tenant-scoped automatically.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Kysely<DB>;
  private readonly als = new AsyncLocalStorage<TenantStore>();

  constructor(config: AppConfigService) {
    // Prefer the non-superuser runtime role so RLS is enforced; fall back to admin.
    this.pool = createDb({
      connectionString: config.env.APP_DATABASE_URL ?? config.env.DATABASE_URL,
    });
  }

  /** Tenant-scoped connection inside runWithTenant(); the raw pool otherwise. */
  get db(): Kysely<DB> {
    return this.als.getStore()?.db ?? this.pool;
  }

  /** Explicit non-tenant pool access (auth/health, which run before a tenant is known). */
  get root(): Kysely<DB> {
    return this.pool;
  }

  /**
   * Run `fn` with `app.current_org` bound to `organizationId` on a pinned
   * connection. The GUC is reset in `finally` so a pooled connection never
   * leaks one tenant's scope into the next request.
   */
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
