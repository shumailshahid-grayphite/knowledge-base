/**
 * Kysely client factory. API and worker each create one via createDb(DATABASE_URL).
 */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './schema.js';

// pgvector/bigint hygiene: return numeric-ish types as JS values we expect.
// bigint (int8, oid 20) -> keep as string to avoid precision loss (file_size).
pg.types.setTypeParser(20, (v) => v);

export interface CreateDbOptions {
  connectionString: string;
  max?: number;
}

export function createDb({ connectionString, max = 10 }: CreateDbOptions): Kysely<DB> {
  const pool = new pg.Pool({ connectionString, max });
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });
}
