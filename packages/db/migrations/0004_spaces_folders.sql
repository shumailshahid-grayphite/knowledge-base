-- 0004_spaces_folders.sql
-- Knowledge spaces (collections agents scope their search to) and folders.

CREATE TABLE knowledge_spaces (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Embedding model is fixed per space so one space never mixes vector dimensions.
  embedding_model  text NOT NULL DEFAULT 'text-embedding-3-small',
  -- Chunking is configurable per space; defaults live in packages/shared.
  chunk_config     jsonb NOT NULL DEFAULT '{"chunkSize":1000,"chunkOverlap":150,"splitter":"recursive"}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX knowledge_spaces_org_name_uniq
  ON knowledge_spaces (organization_id, lower(name));

-- Folders form a tree inside a space; `path` is a materialized path for fast prefix filters.
CREATE TABLE folders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id         uuid NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  parent_id        uuid REFERENCES folders(id) ON DELETE CASCADE,
  name             text NOT NULL,
  path             text NOT NULL DEFAULT '/',   -- e.g. '/HR Policies/2026/'
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX folders_space_parent_idx ON folders (space_id, parent_id);
CREATE INDEX folders_path_idx         ON folders (space_id, path text_pattern_ops);

CREATE TRIGGER knowledge_spaces_set_updated_at
  BEFORE UPDATE ON knowledge_spaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
