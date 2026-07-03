# @kb/db — Database Schema & Migrations

PostgreSQL + pgvector. The SQL migration files in `migrations/` are the **authoritative,
language-neutral schema contract** — the API, the Node worker, and any future Python worker
all target this schema without an ORM in between.

## Running

```bash
# 1. Start Postgres with pgvector (see repo docker-compose in Prompt 2), then:
export DATABASE_URL=postgres://kb:kb@localhost:5432/kb
npm install            # installs `pg`
npm run migrate        # applies migrations/*.sql once each, tracked in schema_migrations
npm run seed           # optional dev data (1 org, 1 user, 1 space)

# Optional defense-in-depth tenant isolation (see below):
psql "$DATABASE_URL" -f migrations/optional/0100_row_level_security.sql
```

Migrations are **immutable**: the runner checksums each file and refuses to start if an
already-applied file changed. Evolve the schema by adding a new numbered migration.

---

## 1. Schema Explanation

| Table | Purpose |
|---|---|
| `organizations` | Tenants. Root of all scoping. |
| `users` | Global identities (may belong to several orgs). |
| `memberships` | User ↔ org with `role` (owner/admin/member/viewer). |
| `knowledge_spaces` | Search collections. Holds `embedding_model` + `chunk_config`. |
| `folders` | Tree inside a space; materialized `path` for prefix filters. |
| `source_connectors` | An upload/gdrive/sharepoint/... connection. Secrets by reference only. |
| `sync_jobs` | One sync run; `cursor` holds the incremental delta/changes token. |
| `documents` | Logical file + provenance + current processing status. |
| `document_versions` | Immutable processed unit. Chunks reference a version. |
| `processing_jobs` | Worker execution mirrored into Postgres (UI reads this, not Redis). |
| `chunks` | Chunk text + inline `vector(1536)` embedding + citation provenance. |
| `query_sessions` / `query_messages` | Chat history. |
| `retrieval_logs` | Every retrieval call (chat or agent tool) for debugging/eval. |
| `audit_logs` | Append-only trail of mutations and sensitive reads. |

**Key modeling decisions**

- **Version is the unit of processing.** Reprocessing writes a new `document_versions` row (or
  replaces chunks for the same version inside one transaction), so old chunks are never left in a
  half-updated state. `documents.current_version_id` points at the live version.
- **`content_hash` + `external_version`** drive dedup and "only reprocess if changed": the sync
  worker compares the source's ETag/checksum before fetching or re-embedding.
- **Embeddings inline on `chunks`.** One table, join-free ANN search. Split into a dedicated
  `embeddings` table only when we need multiple models per chunk.
- **Enums are the shared vocabulary.** `processing_status`, `job_status`, `connector_type`, etc.
  are mirrored in `packages/shared` and `docs/CONTRACTS.md`. Extend with `ALTER TYPE ... ADD VALUE`.

---

## 2. Index Strategy

- Every foreign key used in a filter/join is indexed.
- **Tenant-first composite indexes** on hot paths: `documents(organization_id, space_id)`,
  `chunks(organization_id, space_id)`. All reads pre-filter by tenant + space so the working set
  is small before any expensive operation.
- Status/queue views: `documents(space_id, status)`, `processing_jobs(status)`, `sync_jobs(status)`.
- Dedup: partial unique `documents(organization_id, source_connector_id, source_item_id)` where
  `source_item_id IS NOT NULL` — prevents re-ingesting the same external item.
- Keyword search: GIN `to_tsvector('english', content)` on `chunks` (the lexical half of hybrid).

## 3. pgvector Index Strategy

- **HNSW** on `chunks.embedding` with `vector_cosine_ops`, `m=16, ef_construction=64` — good
  recall/latency for MVP scale. Tune recall per query with `SET hnsw.ef_search = 100;`.
- **Always pre-filter** by `organization_id`/`space_id` (b-tree) before similarity, so the ANN scan
  runs over a small candidate set rather than the whole tenant pool.
- **Fixed dimension (1536).** The column type pins the dimension. Changing embedding model/dimension
  is a migration: add a new `embedding_v2 vector(N)` column (or a versioned `embeddings` table),
  backfill by re-embedding, swap reads, drop the old column. Never mix dimensions in one column —
  `chunks.embedding_model` records which model produced each vector.
- **Scale-out:** at very large tenant volume, switch to IVFFlat (cheaper build, tune `lists` +
  `ANALYZE`) or move vectors to Qdrant/Pinecone behind `VectorStoreService` — no schema change to
  the relational tables.

## 4. Multi-Tenant Isolation Strategy

- **Shared DB, shared schema, row-level scoping** via `organization_id` on every tenant table.
- **Primary enforcement in the app:** a base repository/guard injects `organization_id` into every
  query from the authenticated context — never left to individual handlers.
- **Defense-in-depth (optional):** `migrations/optional/0100_row_level_security.sql` enables Postgres
  RLS with a `tenant_isolation` policy keyed on `current_setting('app.current_org')`. To use it, the
  app/worker sets `SET app.current_org = '<uuid>'` per connection/transaction and connects as a
  non-owner role. The worker sets it per job since it spans tenants.
- **Stronger isolation path** (if a client demands it): schema-per-tenant, DB-per-tenant, or a fully
  dedicated single-tenant deployment — the stack is Compose-deployable without code changes.

## 5. Future Permissions Mapping (SharePoint / Google Drive)

We **capture source ACLs at ingest now** and **enforce at query time later** (Phase 3). Storage:

- `documents.permissions` (jsonb) holds the normalized source ACL, e.g.
  `{ "principals": [{ "type": "user"|"group", "externalId": "...", "email": "...", "role": "read" }] }`.
- `documents.owner_meta` holds owner identity from the source.

Mapping plan when enforcement lands:

1. **SharePoint (Graph):** `/drives/{id}/items/{id}/permissions` → Azure AD user/group object IDs.
   Map object IDs → our `users`/groups via a `principal_mappings` table (added in Phase 3).
2. **Google Drive:** `permissions.list` → Google user emails / group emails / domain. Map emails →
   `users`; domain-wide shares map to an org-wide principal.
3. **Query time:** retrieval adds a permission predicate — only return chunks whose document's
   `permissions` includes a principal the requesting user resolves to. Until then, space membership
   is the access boundary and the gap is documented.

No schema change is needed now to keep this option open — the jsonb columns already carry the raw ACL.

---

## Contracts

The API↔queue↔worker message contract and the status enum vocabulary that this schema encodes are
frozen in [`../../docs/CONTRACTS.md`](../../docs/CONTRACTS.md). Change those in lockstep with any
migration that touches the enums or the `documents`/`document_versions`/`processing_jobs`/`chunks`
tables.
