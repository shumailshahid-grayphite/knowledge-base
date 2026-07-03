#!/usr/bin/env node
// Minimal, dependency-light SQL migration runner.
// Applies every *.sql file in ./migrations (sorted, top-level only; `optional/` is skipped)
// exactly once, each in its own transaction, tracked in the schema_migrations table.
//
// Usage:  DATABASE_URL=postgres://... node run-migrations.mjs
//
// Intentionally ORM-free: the SQL files ARE the schema contract, so a future
// Python worker can rely on them without a Node toolchain.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      );
    `);

    const files = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.sql'))
      .map((e) => e.name)
      .sort();

    const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations;');
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    let ran = 0;
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = sha256(sql);
      if (applied.has(file)) {
        if (applied.get(file) !== checksum) {
          throw new Error(
            `Migration ${file} was modified after being applied (checksum mismatch). ` +
              `Migrations are immutable — add a new migration instead.`,
          );
        }
        continue;
      }
      process.stdout.write(`Applying ${file} ... `);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2);',
          [file, checksum],
        );
        await client.query('COMMIT');
        console.log('ok');
        ran += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw err;
      }
    }
    console.log(ran === 0 ? 'Already up to date.' : `Applied ${ran} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
