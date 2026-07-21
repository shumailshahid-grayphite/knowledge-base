#!/usr/bin/env node
// Idempotent dev seed: one org, one owner user, one knowledge space.
// Safe to run repeatedly. NOT for production.
//
// Usage:  DATABASE_URL=postgres://... node seed.mjs

import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

// Fixed UUIDs so re-runs upsert instead of duplicating.
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const SPACE_ID = '00000000-0000-0000-0000-000000000003';

// Left null on purpose: the auth module (Prompt 2) sets a real bcrypt hash via
// a "set password" flow. Seeding a fake hash would create an unloggable account.
const DEV_PASSWORD_HASH = null;

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO organizations (id, name, slug)
       VALUES ($1, 'Acme Consulting', 'acme')
       ON CONFLICT (id) DO NOTHING;`,
      [ORG_ID],
    );

    await client.query(
      `INSERT INTO users (id, email, name, password_hash)
       VALUES ($1, 'owner@acme.test', 'Acme Owner', $2)
       ON CONFLICT (id) DO NOTHING;`,
      [USER_ID, DEV_PASSWORD_HASH],
    );

    await client.query(
      `INSERT INTO memberships (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (organization_id, user_id) DO NOTHING;`,
      [ORG_ID, USER_ID],
    );

    await client.query(
      `INSERT INTO knowledge_base (id, organization_id, name, description, created_by)
       VALUES ($1, $2, 'Consulting Frameworks', 'Seed space for development', $3)
       ON CONFLICT (id) DO NOTHING;`,
      [SPACE_ID, ORG_ID, USER_ID],
    );

    await client.query('COMMIT');
    console.log('Seed complete.');
    console.log(`  org=${ORG_ID} user=owner@acme.test space=${SPACE_ID}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
