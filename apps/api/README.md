# @kb/api

NestJS API for the knowledge base. **Stateless.** It validates requests, creates
DB records, stores uploaded bytes, and enqueues jobs. It does **not** parse
documents, chunk, embed, or write vectors — the worker does (see
`../../docs/CONTRACTS.md`).

## Modules

| Module | Responsibility |
|---|---|
| `config` | zod-validated env (`AppConfigService`), fails fast on bad config. |
| `database` | single Kysely client (`DatabaseService.db`) over `@kb/db`. |
| `auth` | JWT login + `AuthGuard`; attaches `req.user` (id, org, role). Dev login via `AUTH_DEV_MODE`. |
| `spaces` | knowledge space CRUD; `requireSpace()` enforces tenant scoping. |
| `documents` | upload → store → create records → **enqueue ingest**; list/status/reprocess. |
| `storage` | `StorageProvider` (local FS for dev) behind a DI token. |
| `queue` | `IngestQueueService` — BullMQ producer, enqueue-only, v1 payload. |
| `health` | `GET /health` with DB ping. |

Every tenant-scoped query is filtered by `req.user.organizationId` in the service layer.

## Endpoints

```
POST /auth/login            { email, password, organizationId? } -> { token, user }
POST /auth/dev-login        { email, organizationId? }           -> { token, user }   (AUTH_DEV_MODE only)
GET  /auth/me               (Bearer)                              -> AuthUser

POST /spaces                { name, description?, ... }           -> SpaceResponse
GET  /spaces                                                      -> SpaceResponse[]
GET  /spaces/:id                                                  -> SpaceResponse

POST /spaces/:spaceId/documents   (multipart field "file")       -> DocumentResponse   (status: queued)
GET  /spaces/:spaceId/documents   ?status=&limit=&offset=        -> DocumentResponse[]
GET  /documents/:id                                              -> DocumentResponse
POST /documents/:id/reprocess                                    -> DocumentResponse

GET  /health                                                     -> { status, db }
```

## Run (dev)

```bash
# from repo root
docker compose up -d                 # postgres(pgvector) + redis
cp .env.example .env                 # fill OPENAI_API_KEY later (worker needs it, not the API)
pnpm --filter @kb/db build && pnpm db:migrate && pnpm db:seed
pnpm --filter @kb/shared build

# then:
AUTH_DEV_MODE=true pnpm --filter @kb/api dev
# get a dev token:
curl -s localhost:4000/auth/dev-login -H 'content-type: application/json' \
  -d '{"email":"owner@acme.test"}'
```

Supported upload types (MVP): PDF, DOCX, TXT, Markdown. Uploads land as `queued`;
the worker moves them to `processing` → `completed` / `failed`.
