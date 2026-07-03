-- 0001_extensions.sql
-- Required Postgres extensions.
-- pgcrypto  -> gen_random_uuid()
-- vector    -> pgvector (embeddings + ANN indexes)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
