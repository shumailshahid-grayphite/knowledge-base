# @kb/worker

Background worker. Consumes the `ingest` queue and runs the document pipeline:
**extract → normalize → chunk → embed → store**. Talks only to Postgres, Redis,
and object storage — never to the API (see `../../docs/CONTRACTS.md`). Designed so
a Python worker could replace it against the same schema/queue contract.

## Processing modules

| Service | Role |
|---|---|
| `DocumentProcessor` | Orchestrator; status transitions; idempotent reprocess. |
| `DefaultTextExtractor` (`TextExtractor`) | pdfjs-dist (per-page PDF), mammoth (DOCX), native TXT/MD. Swappable. |
| `ChunkingService` | Paragraph/sentence-aware chunking, configurable size/overlap, preserves page numbers. |
| `EmbeddingService` | Batches over the bound `EmbeddingProvider`. |
| `VectorStoreService` | pgvector upsert / delete-by-version / search. |
| `ConnectorIngestionService` | Stub for the connector phase (Prompts 5/6). |

Embeddings come from `@kb/providers` (real OpenAI when `OPENAI_API_KEY` is set,
deterministic fake otherwise). The worker only sees the `EmbeddingProvider` interface.

## Status flow

`queued` → `processing` → `completed` | `failed` | `needs_review` (no extractable
text). Failures set `error_message` and re-throw so BullMQ retries with backoff.
Reprocessing/redelivery is safe: chunks for the version are deleted before rewrite.

## Run (dev)

```bash
# infra + schema first (see repo root README), then:
pnpm --filter @kb/shared build
pnpm --filter @kb/db build
pnpm --filter @kb/providers build
pnpm --filter @kb/worker dev      # no OPENAI_API_KEY -> deterministic fake embeddings

pnpm --filter @kb/worker test     # chunking unit tests
```
