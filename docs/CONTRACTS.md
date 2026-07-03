# Service Contracts (API ↔ Queue ↔ Worker)

> Frozen boundary. The Node worker is the MVP implementation, but **a Python worker must be able to
> replace it with zero changes to the database schema, the API, or these queue messages.** That is
> only possible if the worker depends *only* on: Postgres (this schema), Redis (these queues), the
> object store (via `storageKey`), and the payloads below — never on API code.

## Architectural rule

```
API           → creates DB records, uploads bytes to object storage, enqueues a job. Returns.
Redis (BullMQ)→ transport only. Carries the payloads below.
Worker        → consumes jobs, reads bytes by storageKey, processes, writes chunks/vectors,
                updates documents / document_versions / processing_jobs status. Never calls the API.
UI/API status → read from Postgres (processing_jobs, documents.status), never from Redis internals.
```

The worker communicates results **exclusively by writing to Postgres and object storage.** There is
no worker→API HTTP path. This is what makes the worker language-agnostic.

---

## Queues

| Queue name | Producer | Consumer | Purpose |
|---|---|---|---|
| `ingest`  | API (upload) / worker (sync) | worker | Process one document version end-to-end. |
| `sync`    | API (connector sync) | worker | Enumerate a source, diff, enqueue `ingest` jobs. |

Redis key prefix: `kb:` (BullMQ `prefix`). Queue concurrency and retry/backoff are worker config,
not part of the contract.

## Message: `ingest` (v1)

```jsonc
{
  "contractVersion": 1,
  "jobType": "ingest_document_version",
  "organizationId": "uuid",
  "spaceId": "uuid",
  "documentId": "uuid",
  "versionId": "uuid",
  "storageKey": "string",        // where the bytes live in the object store
  "mimeType": "string|null",
  "sourceType": "upload|gdrive|sharepoint|onedrive|dropbox|notion|confluence",
  "reprocess": false             // true => replace existing chunks for versionId
}
```

**Worker obligations for `ingest`:**
1. Idempotent, keyed by `(versionId, content_hash)`. Re-delivery must not duplicate chunks.
2. On `reprocess` (or re-run), delete existing `chunks WHERE version_id = versionId` and rewrite —
   in one transaction with the status update.
3. Advance `processing_jobs.stage` through `received → extract → normalize → chunk → embed → store
   → complete`, updating `processing_jobs.status` and `metrics`.
4. Write `document_versions.status` and `documents.status` using the `processing_status` enum.
5. On failure: set status `failed`, populate `error_message` / `processing_jobs.error`, respect
   BullMQ attempts; terminal failures stay `failed` (or `needs_review` for recoverable parse issues).

## Message: `sync` (v1)

```jsonc
{
  "contractVersion": 1,
  "jobType": "connector_sync",
  "organizationId": "uuid",
  "connectorId": "uuid",
  "spaceId": "uuid",
  "syncJobId": "uuid",
  "selector": { /* connector-specific: siteId/driveId/folderIds */ },
  "cursor": "string|null"        // delta link / changes pageToken for incremental sync
}
```

**Worker obligations for `sync`:**
1. Update `sync_jobs.status` (`running → completed|failed|partial`) and `stats`
   (`{found, new, updated, skipped, failed}`).
2. For each remote file: upsert a `documents` row (dedup by
   `(organization_id, source_connector_id, source_item_id)`); compare `external_version`/`content_hash`;
   only create a new `document_versions` + enqueue `ingest` when new or changed.
3. Persist the next `cursor` back onto `sync_jobs` for the following incremental run.
4. Connectors produce files only — parsing happens in the shared `ingest` path.

---

## Status vocabulary (must match `packages/db` enums and `packages/shared`)

| Enum | Values |
|---|---|
| `processing_status` | `uploaded`, `queued`, `processing`, `completed`, `failed`, `needs_review` |
| `job_status` | `queued`, `processing`, `completed`, `failed` |
| `processing_stage` | `received`, `extract`, `normalize`, `chunk`, `embed`, `store`, `complete` |
| `connector_type` / `source_type` | `upload`, `gdrive`, `sharepoint`, `onedrive`, `dropbox`, `notion`, `confluence` |
| `connector_status` | `pending`, `active`, `disconnected`, `error` |
| `sync_status` | `queued`, `running`, `completed`, `failed`, `partial` |
| `membership_role` | `owner`, `admin`, `member`, `viewer` |

## Versioning

- Payloads carry `contractVersion`. Add fields backward-compatibly; bump the version only for
  breaking changes and have the worker handle both during rollout.
- Enum additions are backward-compatible (`ALTER TYPE ... ADD VALUE`); consumers must tolerate
  unknown future values gracefully.
