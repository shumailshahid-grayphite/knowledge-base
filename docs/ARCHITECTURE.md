# Enterprise Knowledge Base — Architecture & Implementation Plan

> Status: MVP planning (no code yet). This is the reference plan referenced by the build prompts.
> Owner: Grayphite. Last updated: 2026-07-02.

---

## 1. Product Purpose and Scope

**Purpose.** A reusable, multi-tenant system that makes a company's scattered documents *AI-ready*. It connects to data sources (upload, Google Drive, SharePoint, later others), ingests and processes documents, chunks and embeds them, stores vectors + rich metadata, and exposes **retrieval APIs with citations** that future AI agents consume as tools.

**Core principle.** The MVP is **not an agent**. It is the *retrieval layer* agents need. Everything is built so that a chat UI and a future agent runtime are just two clients of the same retrieval + tool APIs.

**In scope (product):**
- Knowledge spaces (folder-scoped collections) so agents search a subset, not the whole company.
- Manual upload + connector sync (Google Drive, SharePoint for MVP+).
- Processing pipeline with visible per-document status.
- Rich metadata layer (source URL, folder path, page/slide/sheet, version, permissions).
- Retrieval with grounded answers and exact citations.
- Agent-ready tool layer on top of retrieval.

**Out of scope (for MVP):** OneDrive/Dropbox/Notion/Confluence connectors, OCR, spreadsheet/slide deep parsing, the agents themselves, fine-grained SharePoint ACL enforcement at query time (captured as metadata first, enforced later).

---

## 2. MVP Features

**Phase 1 — Core Knowledge Base (the true MVP):**
- Auth (email/password or SSO-ready), organization + user model.
- Create/list knowledge spaces.
- Upload PDF, DOCX, TXT, Markdown.
- Background processing: extract → normalize → chunk → embed → store.
- Per-document status: `uploaded → queued → processing → completed | failed | needs_review`.
- Ask a question scoped to one knowledge space.
- Grounded answer **with citations** (doc name + page/chunk + source URL).

**Phase 2 — Connectors:** Google Drive + SharePoint (connect, browse folders, select, sync, detect modified, reprocess only changed).

**Phase 3 — Document intelligence:** XLSX/PPTX, table extraction, OCR, duplicate/latest-version detection, metadata filters, hybrid search + rerank.

**Phase 4 — Agent layer:** tool APIs (`searchKnowledgeBase`, `answerFromKnowledgeBase`, `summarizeDocument`, …) and the first agents.

---

## 3. System Architecture

```
                    ┌─────────────────────────────────────────┐
                    │            Frontend (Next.js)            │
                    │  Dashboard · Spaces · Upload · Queue ·   │
                    │  Documents · Ask · Connectors · Settings │
                    └───────────────────┬─────────────────────┘
                                        │ HTTPS / JSON
                    ┌───────────────────▼─────────────────────┐
                    │         API (NestJS, stateless)          │
                    │  Auth · Orgs · Spaces · Documents ·      │
                    │  Connectors · Query · Tools · Jobs(read) │
                    └───┬──────────────┬──────────────┬────────┘
                        │              │              │
            ┌───────────▼──┐   ┌───────▼──────┐  ┌────▼─────────┐
            │ PostgreSQL   │   │ Redis (Bull  │  │ Object store │
            │ + pgvector   │   │ MQ queues)   │  │ (local→S3)   │
            └───────────▲──┘   └───────┬──────┘  └────▲─────────┘
                        │              │              │
                    ┌───┴──────────────▼──────────────┴────────┐
                    │        Worker (NestJS, BullMQ)            │
                    │  Ingest · Extract · Chunk · Embed ·       │
                    │  VectorStore · Connector sync            │
                    └───────────────────┬──────────────────────┘
                                        │
                        ┌───────────────▼───────────────┐
                        │  Provider abstractions          │
                        │  Embeddings · LLM · Storage ·   │
                        │  Connector (Graph/Drive APIs)   │
                        └─────────────────────────────────┘
```

**Deployment shape (MVP):** 3 processes — `api`, `worker`, plus Postgres + Redis. Frontend deployed separately (Vercel or same box). Single Docker Compose for dev; the same images scale horizontally later (multiple workers).

**Why this shape:** API stays fast and stateless; all heavy/latency-variable work (parsing, embedding, sync) is queued to the worker; Postgres+pgvector keeps one datastore for both relational data and vectors (cheaper/simpler for client deployments).

---

## 4. Main Modules

| Module | Responsibility |
|---|---|
| `auth` | Login, sessions/JWT, org membership, roles. |
| `orgs` | Organizations (tenants), members, plan/limits. |
| `spaces` | Knowledge spaces + folders (collection scoping). |
| `documents` | Document + version records, status, metadata. |
| `storage` | `FileStorageService` — local/S3 abstraction. |
| `ingestion` | Orchestrates the pipeline; `DocumentProcessor`. |
| `extraction` | `TextExtractor` per file type. |
| `chunking` | `ChunkingService` — configurable strategies. |
| `embeddings` | `EmbeddingService` — provider abstraction. |
| `vectorstore` | `VectorStoreService` — pgvector read/write. |
| `retrieval` | Query embed, search, rerank, context build. |
| `answering` | Grounded generation + `CitationFormatter`. |
| `connectors` | `SourceConnector` interface + Graph/Drive impls. |
| `jobs` | BullMQ queues, processors, status surfacing. |
| `tools` | Agent-facing tool APIs over retrieval. |
| `audit` | Audit + retrieval logs. |

Each module is a NestJS module with clear service boundaries; connectors and providers sit behind interfaces so nothing leaks vendor specifics into the core.

---

## 5. Database Schema (conceptual)

PostgreSQL + pgvector. All tenant-scoped tables carry `organization_id`.

```
organizations(id, name, created_at)
users(id, email, password_hash, name, created_at)
memberships(id, organization_id, user_id, role)              -- owner|admin|member|viewer

knowledge_spaces(id, organization_id, name, description, created_by, created_at)
folders(id, organization_id, space_id, parent_id, name, path) -- materialized path

source_connectors(id, organization_id, type, name, status,
                  config_json, credentials_ref, created_by, created_at)
                  -- type: upload|gdrive|sharepoint ; credentials in secret store, not raw
sync_jobs(id, organization_id, connector_id, space_id, folder_selector_json,
          status, stats_json, started_at, finished_at, error)

documents(id, organization_id, space_id, folder_id,
          source_type, source_connector_id, source_item_id, source_url,
          file_name, mime_type, file_size, folder_path,
          owner_meta_json, permissions_json,
          created_date, modified_date, external_version,   -- etag/checksum
          storage_key, status, error_message, metadata_json,
          content_hash, latest_version_id, created_at, updated_at)
document_versions(id, document_id, version_no, storage_key,
                  external_version, content_hash, created_at)

processing_jobs(id, organization_id, document_id, version_id,
                stage, status, attempts, error, logs_ref, created_at, updated_at)

chunks(id, organization_id, document_id, version_id, space_id,
       chunk_index, text, token_count,
       page_number, sheet_name, slide_number,
       metadata_json, embedding VECTOR(1536), created_at)

query_sessions(id, organization_id, space_id, user_id, created_at)
retrieval_logs(id, organization_id, space_id, query, filters_json,
               retrieved_chunk_ids, scores_json, answer, citations_json, latency_ms, created_at)
audit_logs(id, organization_id, actor_id, action, target_type, target_id, meta_json, created_at)
```

**Notes:**
- `content_hash` enables dedup + idempotent reprocessing.
- `external_version` (ETag for SharePoint, `version`/`md5Checksum` for Drive) drives "only reprocess if changed".
- `permissions_json` stores source ACLs now; query-time enforcement comes later.
- Embedding stored inline on `chunks` for MVP simplicity (one table, one join-free search). Split into a dedicated `embeddings` table only if we later support multiple embedding models per chunk.

---

## 6. Vector Storage Strategy

- **Store:** pgvector column on `chunks`, dimension fixed per configured embedding model (e.g. 1536 for `text-embedding-3-small`).
- **Index:** HNSW (`vector_cosine_ops`) for good recall/latency; IVFFlat as a fallback for very large tenants where build cost matters. Create the index after initial bulk load.
- **Filtering:** always pre-filter by `organization_id` + `space_id` (+ optional metadata) *before* similarity, using a composite b-tree index so the vector scan runs on a small candidate set.
- **Model change path:** embedding model/dimension is config; changing it requires a re-embed migration (new column or versioned `embeddings` table). Record `embedding_model` in `metadata_json` so we never mix dimensions in one search.
- **Scale-out path:** if a single tenant outgrows pgvector, the `VectorStoreService` interface lets us swap in Qdrant/Pinecone without touching retrieval logic.

---

## 7. Document Processing Pipeline

Stages (each logged, each a resumable step):

```
receive → store file → create document + version record → enqueue job
 → detect type → extract text (+ tables later) → normalize
 → chunk → embed (batched) → upsert chunks+vectors
 → mark completed  (or failed w/ error_message / needs_review)
```

**Guarantees:**
- Runs entirely in the worker; the upload request only stores the file and enqueues.
- **Idempotent:** keyed by `(document_id, version_id, content_hash)`. Reprocessing deletes old chunks for that version in a transaction, then writes new ones (no partial/duplicated state).
- Per-stage status + `attempts`; BullMQ ret/backoff; poison jobs land in a dead-letter/`failed` state with the error surfaced in the UI.
- Large files streamed; embedding calls batched with concurrency limits and rate-limit handling.

**Services:** `FileStorageService`, `DocumentService`, `ProcessingQueue`, `DocumentProcessor` (orchestrator), `TextExtractor`, `ChunkingService`, `EmbeddingService`, `VectorStoreService`.

---

## 8. Chunking Strategy

- **Default:** structure-aware recursive splitter — respect paragraph/heading/page boundaries first, then split to a target size.
- **Config (per space, with global default):** `chunkSize` (~800–1000 tokens), `chunkOverlap` (~120–150 tokens), `splitter` strategy.
- **Preserve provenance on every chunk:** `page_number` (PDF), later `slide_number` (PPTX) / `sheet_name` (XLSX), plus `chunk_index` and source doc reference — this is what makes citations exact.
- **Token-aware:** count with the embedding model's tokenizer so chunks fit the embedding context and downstream LLM budget.
- **Tables (later):** extract as structured blocks and keep them intact rather than splitting mid-row.

---

## 9. Metadata Strategy

Metadata is a first-class citizen, not an afterthought — it powers filtering *and* citations. Every chunk can be traced to: document → version → source. Stored fields: file name, source type/URL, folder path, created/modified dates, owner, MIME/type, external version, permissions, processing status, and location (page/sheet/slide/chunk index). Arbitrary source-specific fields go in `metadata_json` so we never need a migration to capture a new connector's quirks.

---

## 10. Connector Architecture

A single interface, many implementations. Core pipeline never imports connector-specific code.

```ts
interface SourceConnector {
  type: 'gdrive' | 'sharepoint' | ...;
  authUrl(ctx): string;                       // OAuth start
  handleCallback(ctx, code): Credentials;     // exchange + store securely
  listRoots(conn): Node[];                     // sites/drives/top folders
  listChildren(conn, nodeId): Node[];          // browse
  listFiles(conn, selector): RemoteFile[];     // supported files under selection
  fetchFile(conn, file): Stream;               // download/export bytes
  toDocumentMeta(file): DocumentMeta;          // normalize into our schema
}
```

Flow: connect (OAuth) → browse → select folders → persist `source_connector` + `sync_job` → worker calls `listFiles` → for each, compare `external_version`/`content_hash` → new/changed only → `fetchFile` → **hand bytes to the existing pipeline** (connectors produce files; they do not parse). Credentials live in a secret store / encrypted column, referenced by `credentials_ref`; tokens refreshed on demand.

---

## 11. SharePoint Connector Design

- **API:** Microsoft Graph. **Auth:** OAuth 2.0 (Azure AD app; delegated for user-scoped, app-only optional later).
- **Browse:** `/sites` → `/sites/{id}/drives` → `/drives/{id}/root/children` (recurse folders).
- **Sync:** use Graph **delta queries** (`/drives/{id}/root/delta`) to fetch only changes efficiently; fall back to ETag comparison.
- **Metadata captured:** site ID, drive ID, item ID, webUrl, name, folder path, created/modified, **eTag** (change detection), and `permissions` (from `/items/{id}/permissions`) stored for later enforcement.
- **Files:** download via `@microsoft.graph.downloadUrl`; push into pipeline. Dedup by item ID + content hash; reprocess only when eTag changes.

---

## 12. Google Drive Connector Design

- **API:** Google Drive API v3. **Auth:** OAuth 2.0 (offline access for refresh tokens).
- **Browse:** `files.list` with `q="'{folderId}' in parents"`, paginated; folders are files with the folder MIME type.
- **Change detection:** `md5Checksum` / `version` / `modifiedTime`; optionally the **Changes API** (`changes.list` + page token) for incremental sync.
- **Native Google types:** export Google Docs → DOCX/plain text, Slides/Sheets later via `files.export`; binary files via `files.get?alt=media`.
- **Metadata captured:** file ID, webViewLink, name, MIME type, folder path, createdTime, modifiedTime, md5Checksum/version, owners. Dedup by file ID + checksum.

Both connectors reuse the exact same `SourceConnector` contract and downstream pipeline — SharePoint proves the pattern, Drive is a second implementation with no core changes.

---

## 13. Background Job Flow

Queues (BullMQ + Redis):
- `ingest` — one job per document/version: extract → chunk → embed → store.
- `sync` — one job per connector sync run: enumerate + diff + enqueue `ingest` jobs per changed file.
- (later) `reindex`, `reembed`.

Properties: retries with exponential backoff, per-queue concurrency caps, idempotency keys, structured per-stage logs, and job/document status mirrored into Postgres so the UI Processing Queue reads from the DB (not Redis internals). Failed jobs retain `error_message` for display and manual retry.

---

## 14. API Routes (representative)

```
POST   /auth/login · /auth/refresh · GET /auth/me
GET/POST /orgs · /orgs/:id/members

GET/POST      /spaces            PATCH/DELETE /spaces/:id
GET/POST      /spaces/:id/folders

POST   /spaces/:id/documents            # multipart upload → store + enqueue
GET    /spaces/:id/documents            # list + status + filters
GET    /documents/:id                   # detail + versions + chunks meta
POST   /documents/:id/reprocess
DELETE /documents/:id

GET    /processing/jobs                  # queue view (status, errors)

# Connectors
POST   /connectors/:type/auth-url
GET    /connectors/:type/callback
GET    /connectors/:id/browse?nodeId=
POST   /connectors                       # create connector record
POST   /connectors/:id/sync              # select folders → sync job
GET    /connectors/:id/sync-history

# Retrieval / chat
POST   /spaces/:id/query                 # {question, filters} → answer + citations
GET    /spaces/:id/query-logs

# Agent tool layer (Phase 4)
POST   /tools/searchKnowledgeBase
POST   /tools/answerFromKnowledgeBase
POST   /tools/getDocumentById · /getDocumentChunks · /summarizeDocument · /compareDocuments
GET    /tools/listKnowledgeSpaces · /listDocuments · /getRecentDocuments
```

All routes are org-scoped via auth context; tool routes share the same authorization guards as the UI routes.

---

## 15. Frontend Pages (Next.js)

Login · Dashboard · Knowledge Spaces (list/create) · Space detail · Upload Documents · Documents List (with status + filters) · Processing Queue · Connect Sources (OAuth + folder picker) · Sync History · Ask / Search (answer + citation panel) · Agent Playground (later) · Settings.

The Ask page is the flagship: shows the grounded answer, a citations list (doc name → page/chunk → deep link to source URL), and "not found in this knowledge space" when retrieval is empty.

---

## 16. Security and Permissions

- **AuthN:** JWT sessions; SSO-ready. **AuthZ:** role-based (owner/admin/member/viewer) enforced in a guard layer.
- **Tenant isolation:** every query filtered by `organization_id`; enforced in a base repository/guard, never left to individual handlers.
- **Secrets:** OAuth tokens encrypted at rest (KMS/secret store), referenced by `credentials_ref`; never logged.
- **Source ACLs:** captured in `permissions_json` at ingest; **document-level filtering at query time is a Phase 3+ enforcement step** (map SharePoint/Drive principals → our users/groups).
- **Grounding safety:** answers use retrieved context only; refuse to answer company questions from model general knowledge; never fabricate citations.
- **Audit:** all mutating actions + retrievals logged.

---

## 17. Multi-Tenant Design

Shared-database, shared-schema, **row-level tenant scoping** via `organization_id` on every tenant table (simplest to operate for many client deployments). Enforced centrally so it can't be forgotten per-endpoint. Postgres **Row-Level Security** policies as defense-in-depth. Path to stronger isolation if a client demands it: schema-per-tenant or DB-per-tenant, or a dedicated single-tenant deployment (the whole stack is Compose-deployable). Vector search always inherits the same tenant filter.

---

## 18. How Future Agents Use This

Agents are just another client of the **tool layer** (§14). Each tool returns structured JSON with citations and respects org/space/permission boundaries. Example agent turn:

```
Agent (Consultant) → tool: searchKnowledgeBase({spaceId, query:"public sector governance", topK:8})
  ← chunks + citations
Agent → tool: answerFromKnowledgeBase({spaceId, question, filters:{sourceType:"gdrive"}})
  ← grounded answer + citations
Agent → tool: compareDocuments({idA, idB})  → summarizeDocument({id})  → drafts proposal
```

Because retrieval, scoping, and citation live in the platform (not in each agent), every future agent — consultant, proposal, HR policy, drafting — reuses the same guarantees.

---

## 19. Risks and Tradeoffs

| Risk | Mitigation |
|---|---|
| pgvector performance at large scale | HNSW + tight pre-filtering; `VectorStoreService` lets us swap to Qdrant/Pinecone. |
| Embedding model lock-in / dimension change | Model is config; record `embedding_model`; re-embed migration path. |
| Connector API rate limits / token expiry | Delta/Changes APIs, backoff, refresh-token handling, per-connector concurrency caps. |
| Parsing quality (bad PDFs, scans) | `needs_review` status; OCR in Phase 3; never silently drop content. |
| Query-time permission gaps | Capture ACLs now, enforce later; document the gap explicitly. |
| Hallucinated / wrong citations | Answer only from retrieved chunks; citation IDs tied to real chunk records; "not found" path. |
| Over-engineering the MVP | Ship Phase 1 (upload → ask with citations) before any connector. |
| Cost (embeddings/LLM) | Batch embeddings, dedup by content hash, cache query embeddings, log token usage. |

---

## 20. Step-by-Step Implementation Plan

**Build order (foundation first):**

0. **Repo + infra:** monorepo (`apps/api`, `apps/worker`, `apps/web`, `packages/shared`), Docker Compose (Postgres+pgvector, Redis), env config, migrations tooling, logging.
1. **Schema + migrations:** orgs, users, memberships, spaces, folders, documents, versions, chunks, jobs, logs (§5). Seed data.
2. **Auth + orgs:** login, JWT, membership guard, tenant scoping base.
3. **Spaces + folders:** CRUD APIs + UI.
4. **Upload + storage:** `FileStorageService` (local), upload endpoint, document/version records, enqueue.
5. **Processing pipeline (worker):** extractor (PDF/DOCX/TXT/MD) → chunking → embeddings (OpenAI behind interface) → pgvector store; status + logs; idempotent reprocess. **Tests for chunking + flow.**
6. **Retrieval + answer:** query embed → filtered vector search → context build → grounded answer → `CitationFormatter`; `retrieval_logs`. **Tests.**
7. **Frontend Phase 1:** Spaces, Upload, Documents list, Processing Queue, Ask-with-citations, Settings.
8. **Connector abstraction + Google Drive:** OAuth, browse, select, sync job, diff-by-checksum, reuse pipeline; sync UI + history.
9. **SharePoint connector:** Graph OAuth, sites/drives/folders, delta sync, ETag diff, permissions capture.
10. **Admin/dashboard + hardening:** metrics, audit, error surfaces.
11. **Permission mapping (Phase 3 start):** map source ACLs → users/groups; query-time filtering.
12. **Agent tool layer (Phase 4):** tool APIs + schemas + docs + tests; Agent Playground.

**Definition of done for the MVP (stop-and-demo point):** a user logs in, creates a knowledge space, uploads a PDF/DOCX/TXT/MD, watches it reach `completed`, asks a question, and gets a grounded answer citing the document name and page/chunk — all tenant-isolated, provider-abstracted, and connector-ready.
