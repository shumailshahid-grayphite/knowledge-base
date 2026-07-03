# Enterprise Knowledge Base

A reusable, multi-tenant system that makes scattered company documents **AI-ready**:
ingest → process → chunk → embed → store, exposing retrieval APIs with citations for
future AI agents. The MVP is the *retrieval foundation*, not an agent.

See `docs/ARCHITECTURE.md` for the full design and `docs/CONTRACTS.md` for the frozen
API↔queue↔worker boundary.

## Monorepo layout

```
apps/
  web/        Next.js frontend            — dashboard, spaces, upload, ask, connect sources
  api/        NestJS API (stateless)      — validate, store, create records, enqueue, OAuth
  worker/     NestJS worker               — extract, chunk, embed, write vectors, connector sync
packages/
  shared/     types, DTOs, enums, queue contracts, PROVIDER INTERFACES
  db/         SQL migrations (the schema contract) + Kysely types + client
  providers/  OpenAI + deterministic fake providers (embeddings, LLM, reranker)
  connectors/ Google Drive + SharePoint connectors, credential encryption, OAuth state
```

**Architectural rules (enforced structurally):**
- The API never parses/embeds — it only enqueues the frozen v1 job.
- The worker only touches Postgres/Redis/storage — never the API. Swappable for a Python worker.
- Connectors *produce files*; the shared pipeline processes them. Retrieval only searches processed chunks. Agents only use retrieval/tool APIs.

## Prerequisites

- Node ≥ 20, pnpm ≥ 9, Docker (for Postgres+pgvector and Redis).

## Setup

```bash
cp .env.example .env
docker compose up -d                       # postgres(pgvector) + redis

pnpm install
pnpm --filter @kb/shared build
pnpm --filter @kb/db build
pnpm --filter @kb/providers build

pnpm db:migrate                            # apply SQL migrations
pnpm db:seed                               # 1 org, 1 user (owner@acme.test), 1 space

# Run API + worker (no OPENAI_API_KEY -> deterministic fake embeddings)
AUTH_DEV_MODE=true pnpm --filter @kb/api dev
pnpm --filter @kb/worker dev
```

### Try the upload → process flow

```bash
TOKEN=$(curl -s localhost:4000/auth/dev-login -H 'content-type: application/json' \
  -d '{"email":"owner@acme.test"}' | jq -r .token)

# create a space (or use the seeded one)
SPACE=$(curl -s localhost:4000/spaces -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Demo"}' | jq -r .id)

# upload a file -> status "queued", worker processes -> "completed"
curl -s -X POST "localhost:4000/spaces/$SPACE/documents" \
  -H "authorization: Bearer $TOKEN" -F "file=@./some.pdf"

curl -s "localhost:4000/spaces/$SPACE/documents" -H "authorization: Bearer $TOKEN" | jq
```

## AI providers

Set `OPENAI_API_KEY` to use real embeddings (`text-embedding-3-small`) and answers.
Without a key in dev, deterministic **fake** providers run so the full pipeline works
with no cost. Production fails fast if real credentials are missing. Override with
`AI_PROVIDER=openai|fake`. Provider logic lives only in `@kb/providers`.

## Status

- [x] `packages/db` — schema + migrations (validated against pgvector)
- [x] `packages/shared` — contracts, DTOs, provider interfaces
- [x] `packages/providers` — OpenAI + fake (embeddings & LLM)
- [x] `apps/api` — auth, spaces, documents (upload → enqueue), health
- [x] `apps/worker` — ingest pipeline (pdfjs/mammoth → chunk → embed → pgvector)
- [x] Retrieval + answer API with citations
- [x] `apps/web` — Phase 1 pages (dashboard, spaces, upload, ask-with-citations, settings)
- [x] Hybrid retrieval (vector + full-text) + heuristic reranking
- [x] Connectors (Google Drive + SharePoint) — OAuth, browse, sync, change-detection
- [ ] Agent tool layer

> Note: build/test currently require a working local Node toolchain. `packages/db`
> migrations are verified against live Postgres+pgvector; app TypeScript is written
> to compile under the shared config once `pnpm install` + build are run.
