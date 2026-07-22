-- 0015_remote_object_mapping.sql
-- Stable link between a remote source item and the internal document it produced.
-- Keyed by the immutable remote id so renames/moves are metadata updates (not
-- re-ingests), and so a sync can detect items that disappeared at the source.

CREATE TABLE remote_object_mapping (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id       uuid NOT NULL REFERENCES source_connectors(id) ON DELETE CASCADE,
  remote_item_id     text NOT NULL,
  document_id        uuid REFERENCES documents(id) ON DELETE SET NULL,
  remote_path        text,          -- source folder path at last sight (e.g. '/HR/2026/')
  etag               text,          -- external_version at last sight
  last_seen_sync_id  uuid,          -- the sync run that most recently observed it
  deleted_at         timestamptz,   -- set when the item is gone from the source
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX remote_object_mapping_uniq ON remote_object_mapping (connector_id, remote_item_id);
CREATE INDEX remote_object_mapping_doc_idx ON remote_object_mapping (document_id);

CREATE TRIGGER remote_object_mapping_set_updated_at
  BEFORE UPDATE ON remote_object_mapping
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tenant isolation (same fail-closed policy as every tenant table; migration 0013).
ALTER TABLE remote_object_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_object_mapping FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON remote_object_mapping
  USING (organization_id = nullif(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.current_org', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON remote_object_mapping TO kb_app;
