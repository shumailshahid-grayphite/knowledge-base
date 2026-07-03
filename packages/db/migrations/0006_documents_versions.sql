-- 0006_documents_versions.sql
-- Documents (logical file) and document_versions (the immutable unit that gets processed).
-- Chunks always reference a version_id, so reprocessing a new version never corrupts old data.

CREATE TABLE documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id              uuid NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  folder_id             uuid REFERENCES folders(id) ON DELETE SET NULL,

  -- Provenance
  source_type           connector_type NOT NULL DEFAULT 'upload',
  source_connector_id   uuid REFERENCES source_connectors(id) ON DELETE SET NULL,
  source_item_id        text,        -- external id (Graph item id / Drive file id)
  source_url            text,        -- webUrl / webViewLink for citations
  file_name             text NOT NULL,
  mime_type             text,
  file_size             bigint,
  folder_path           text,

  -- Source-provided metadata
  owner_meta            jsonb NOT NULL DEFAULT '{}',
  permissions           jsonb NOT NULL DEFAULT '{}',   -- captured now, enforced later
  external_created_at   timestamptz,
  external_modified_at  timestamptz,
  external_version      text,        -- ETag / version / checksum from source

  -- Local state
  content_hash          text,        -- sha256 of current bytes (dedup + idempotency)
  storage_key           text,        -- current bytes location in object storage
  status                processing_status NOT NULL DEFAULT 'uploaded',
  error_message         text,
  metadata              jsonb NOT NULL DEFAULT '{}',
  current_version_id    uuid,        -- FK added after document_versions exists

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_org_space_idx  ON documents (organization_id, space_id);
CREATE INDEX documents_space_status_idx ON documents (space_id, status);
CREATE INDEX documents_connector_idx   ON documents (source_connector_id);
-- Prevent duplicate ingestion of the same external item within a connector.
CREATE UNIQUE INDEX documents_source_item_uniq
  ON documents (organization_id, source_connector_id, source_item_id)
  WHERE source_item_id IS NOT NULL;

CREATE TABLE document_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_no       int  NOT NULL,
  storage_key      text NOT NULL,
  mime_type        text,
  file_size        bigint,
  external_version text,
  content_hash     text NOT NULL,
  status           processing_status NOT NULL DEFAULT 'queued',
  error_message    text,
  metadata         jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_no)
);
CREATE INDEX document_versions_document_idx ON document_versions (document_id);

-- Resolve the documents -> versions circular reference now that both tables exist.
ALTER TABLE documents
  ADD CONSTRAINT documents_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES document_versions(id) ON DELETE SET NULL;

CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
