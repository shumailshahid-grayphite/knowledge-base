-- 0008_chunks.sql
-- Extracted, embeddable chunks. Embeddings are stored inline for MVP (one table,
-- join-free ANN search). Dimension is fixed at 1536 (text-embedding-3-small).
-- Changing embedding model/dimension => re-embed migration (see packages/db/README.md).

CREATE TABLE chunks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id         uuid NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  document_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id       uuid NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,

  chunk_index      int  NOT NULL,
  content          text NOT NULL,
  token_count      int,
  content_hash     text,           -- for chunk-level dedup / idempotent replace

  -- Provenance for exact citations (nullable until the file type provides them).
  page_number      int,
  sheet_name       text,           -- future: Excel
  slide_number     int,            -- future: PowerPoint

  embedding        vector(1536),   -- null until the embed stage completes
  embedding_model  text,           -- which model produced `embedding`
  metadata         jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (version_id, chunk_index)
);

-- Tenant/space pre-filter: always applied BEFORE similarity so the ANN scan
-- runs over a small candidate set.
CREATE INDEX chunks_org_space_idx ON chunks (organization_id, space_id);
CREATE INDEX chunks_document_idx  ON chunks (document_id);

-- ANN index for cosine similarity search. HNSW = good recall/latency for MVP scale.
-- Alternative for very large tenants: IVFFlat (cheaper build, needs ANALYZE + lists tuning).
-- Query-time recall knob:  SET hnsw.ef_search = 100;
CREATE INDEX chunks_embedding_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Keyword half of future hybrid search (vector + BM25-ish). Cheap to add now.
CREATE INDEX chunks_content_fts
  ON chunks USING gin (to_tsvector('english', content));
