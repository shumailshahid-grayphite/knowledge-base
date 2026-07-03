# Connector Architecture & Plan (Google Drive + SharePoint)

> Status: plan (approved to implement Drive → SharePoint). Reuses the existing
> `SourceConnector` interface (`@kb/shared`), `SyncJobV1` contract, and the
> `source_connectors` / `sync_jobs` / `documents` schema. Adds only what's missing:
> secure credential storage, OAuth, a connector registry, and a `sync` worker.

## 1. Principles

- **Connectors produce files; they never parse.** They list/download bytes and hand them to the
  existing ingest pipeline (`DocumentProcessor`). Retrieval only ever sees processed chunks.
- **One interface, many sources.** `SourceConnector` (already in `@kb/shared`) is the contract;
  Drive proves the pattern, SharePoint is a second impl, OneDrive/Dropbox/Notion/Confluence later.
- **No connector logic in the core pipeline or the API request path.** The API only does OAuth +
  record-keeping + enqueue. The worker does the actual sync. Same API↔queue↔worker split as ingest.
- **Change-only reprocessing.** Compare source `external_version` (ETag / checksum / version) and
  `content_hash`; only new/changed files create a new `document_versions` + `ingest` job.

## 2. New package: `@kb/connectors`

Shared by API (OAuth, browse) and worker (sync). Keeps vendor SDKs out of the apps.

```
packages/connectors/src/
  credential-cipher.ts     AES-256-GCM encrypt/decrypt of OAuth tokens (node:crypto)
  registry.ts              getConnector(type) -> SourceConnector
  oauth-state.ts           sign/verify the OAuth `state` (HMAC, stateless — no table)
  google-drive.connector.ts
  sharepoint.connector.ts
  index.ts
```

Vendor calls use plain `fetch` against Microsoft Graph / Google Drive REST (no heavy SDKs), so the
package stays light and Node-only. The apps depend on `@kb/connectors`; `web` never imports it.

## 3. Database changes (one migration)

The only missing table is encrypted credential storage. Everything else already exists.

`0011_connector_secrets.sql`:

```sql
CREATE TABLE connector_secrets (
  connector_id     uuid PRIMARY KEY REFERENCES source_connectors(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ciphertext       text NOT NULL,   -- base64 AES-256-GCM ciphertext of the token JSON
  iv               text NOT NULL,   -- base64 nonce
  auth_tag         text NOT NULL,   -- base64 GCM auth tag
  key_version      int  NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

- Tokens are **never** stored in `source_connectors` (only `credentials_ref` points here logically).
- `key_version` supports key rotation later.
- `ConnectorSecretsTable` added to `packages/db` Kysely types.

No other schema change: `documents.source_item_id/source_url/external_version/permissions/owner_meta`,
the partial-unique `documents(org, source_connector_id, source_item_id)` index, and `sync_jobs.cursor`
(for delta/changes tokens) already support connector sync.

## 4. Credential encryption

`CredentialCipher` (in `@kb/connectors`) uses AES-256-GCM with a key from `CONNECTOR_ENCRYPTION_KEY`
(base64, 32 bytes). API encrypts tokens on OAuth callback and writes `connector_secrets`; the worker
decrypts them at sync time. Keys never logged; ciphertext + iv + tag stored separately.

## 5. OAuth flow (stateless `state`)

```
Browser → API  GET  /connectors/:type/auth-url?spaceId=&name=      (auth: bearer)
                     → returns { url } to the provider consent screen
                     state = HMAC-signed { orgId, userId, spaceId, name, type, nonce }
Browser → Provider consent → redirect to
         API  GET  /connectors/:type/callback?code=&state=
                     verify state; exchange code→tokens (connector.handleCallback);
                     create source_connectors row (status=active);
                     encrypt+store connector_secrets;
                     redirect browser → WEB_PUBLIC_URL/connectors/:id
```

- Redirect URI: `${API_PUBLIC_URL}/connectors/:type/callback` (registered in Google/Azure app).
- `state` is a short-lived signed token (reuses HMAC with `OAUTH_STATE_SECRET` or `JWT_SECRET`); no
  DB/Redis needed to correlate the round-trip.
- Interface refinement: `authUrl({ state, redirectUri, scopes })` and
  `handleCallback({ code, redirectUri })` so the same impl works across environments. `refresh()`
  is called by the worker when a token is near expiry.

## 6. Sync flow (API enqueues, worker executes)

```
Browser → API  GET  /connectors/:id/browse?nodeId=        list sites/drives/folders (connector.listChildren)
Browser → API  POST /connectors/:id/sync { selector }     create sync_jobs row; enqueue SyncJobV1 on `sync`
                                                           queue (contract already frozen)
Worker  (sync queue) ConnectorIngestionService.runSync(payload):
   1. load connector + decrypt credentials; refresh token if needed
   2. connector.listFiles(ctx, selector, cursor)  → supported files (+ nextCursor)
   3. for each file: upsert documents row (dedup by org+connector+source_item_id)
        - if new OR external_version changed → download via connector.fetchFile,
          store bytes, create document_versions, enqueue standard `ingest` job (reuse pipeline)
        - else → skip (unchanged)
   4. persist nextCursor on sync_jobs; update stats {found,new,updated,skipped,failed}; status=completed
```

The worker gains a **`SyncWorker`** (BullMQ consumer of `sync`) alongside the existing `IngestWorker`.
`ConnectorIngestionService` (currently a stub) is implemented here. Downstream ingest is unchanged.

## 7. Change detection & dedup

- Dedup identity: `(organization_id, source_connector_id, source_item_id)` (partial-unique index).
- Change signal: `external_version` — Drive `md5Checksum`/`version`/`modifiedTime`; SharePoint `eTag`.
- Incremental: `sync_jobs.cursor` holds Drive `changes` pageToken / SharePoint `delta` link. First run
  is a full enumeration; later runs use the cursor.
- Deletions: out of MVP scope (documented). A future pass can soft-delete documents missing from the
  source and remove their chunks.

## 8. Google Drive connector

- **API:** Drive v3 REST. **Auth:** OAuth 2.0, offline access (refresh token). **Scopes:**
  `drive.readonly`.
- **Browse:** `files.list?q='<folderId>' in parents and trashed=false`; folders are the folder MIME.
- **Files:** supported MIME (PDF/DOCX/TXT/MD) via `files.get?alt=media`; **Google Docs** exported to
  DOCX via `files.export`. Google Slides/Sheets deferred.
- **Metadata:** file id, webViewLink, name, mimeType, parents/path, createdTime, modifiedTime,
  `md5Checksum`/`version`, owners.
- **Incremental:** `changes.list` + `startPageToken` stored in `sync_jobs.cursor`.

## 9. SharePoint connector

- **API:** Microsoft Graph. **Auth:** OAuth 2.0 (Azure AD app; delegated). **Scopes:**
  `Sites.Read.All Files.Read.All offline_access`.
- **Browse:** `/sites?search=` → `/sites/{id}/drives` → `/drives/{id}/root/children` (recurse).
- **Files:** download via `@microsoft.graph.downloadUrl`.
- **Metadata:** siteId, driveId, itemId, webUrl, name, folder path, created/modified, **eTag**,
  and `/items/{id}/permissions` → `documents.permissions` (captured now, enforced later).
- **Incremental:** `/drives/{id}/root/delta`; delta link stored in `sync_jobs.cursor`.

## 10. API routes (new)

```
GET  /connectors                          list connectors for the org
GET  /connectors/:type/auth-url           begin OAuth (returns provider url)
GET  /connectors/:type/callback           OAuth redirect target (exchanges code, stores secret)
GET  /connectors/:id/browse?nodeId=       list sites/drives/folders
POST /connectors/:id/sync                 { selector } → create sync job + enqueue
GET  /connectors/:id/sync-history         recent sync_jobs
DELETE /connectors/:id                     remove connector (+ cascade secrets)
```

## 11. Frontend (Connect Sources)

- `/connectors` — list connections + "Connect Google Drive / SharePoint" buttons (→ auth-url).
- `/connectors/:id` — folder picker (browse tree), choose target space, "Sync now", sync history with
  stats + errors.
- Documents synced from a source show their `sourceUrl` as a clickable citation (already supported).

## 12. Security

- Tokens encrypted at rest (AES-256-GCM); decrypted only in the worker at sync time.
- OAuth `state` HMAC-signed and short-lived (CSRF/replay protection).
- All connector/sync records org-scoped; browse/sync authorize via the same `AuthGuard`.
- Source ACLs captured into `documents.permissions`; query-time enforcement remains Phase 3.

## 13. Implementation sequence

1. **Migration** `0011_connector_secrets` + Kysely type (this step; validated).
2. `@kb/connectors`: `CredentialCipher`, `oauth-state`, `registry`, refined interface usage.
3. Refine `SourceConnector` signatures (`authUrl`/`handleCallback` params) in `@kb/shared`.
4. **API** `connectors` module: OAuth endpoints, connector CRUD, browse, `POST /sync` → `sync` queue.
5. **Worker** `SyncWorker` + real `ConnectorIngestionService` (list → diff → download → ingest).
6. **Google Drive** connector impl + test against real pipeline (Drive MCP available to sanity-check).
7. **SharePoint** connector impl.
8. **Frontend** Connect Sources pages.
9. Build + integration tests (sync a folder end-to-end with a mocked connector, verify dedup/change).

## 14. Environment variables (added)

```
CONNECTOR_ENCRYPTION_KEY=   # base64, 32 bytes (openssl rand -base64 32)
API_PUBLIC_URL=http://localhost:4000
WEB_PUBLIC_URL=http://localhost:3000
OAUTH_STATE_SECRET=         # or reuse JWT_SECRET

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_TENANT=common
```
