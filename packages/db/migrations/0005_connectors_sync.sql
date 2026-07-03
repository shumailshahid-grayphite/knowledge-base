-- 0005_connectors_sync.sql
-- Source connectors (upload/gdrive/sharepoint/...) and their sync runs.
-- Credentials are NEVER stored raw here: credentials_ref points to a secret store entry.

CREATE TABLE source_connectors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type             connector_type NOT NULL,
  name             text NOT NULL,
  status           connector_status NOT NULL DEFAULT 'pending',
  -- Non-secret config: tenant id, selected site ids, scopes, etc.
  config           jsonb NOT NULL DEFAULT '{}',
  -- Pointer into the secret store (KMS/Vault/encrypted table). Not the token itself.
  credentials_ref  text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_connectors_org_idx ON source_connectors (organization_id, type);

-- One row per sync run. `cursor` holds the incremental token
-- (SharePoint delta link / Google Drive changes pageToken).
CREATE TABLE sync_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_id     uuid NOT NULL REFERENCES source_connectors(id) ON DELETE CASCADE,
  space_id         uuid NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  selector         jsonb NOT NULL DEFAULT '{}',   -- which sites/drives/folders to sync
  status           sync_status NOT NULL DEFAULT 'queued',
  stats            jsonb NOT NULL DEFAULT '{}',    -- {found, new, updated, skipped, failed}
  cursor           text,
  error            text,
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_jobs_connector_idx ON sync_jobs (connector_id, created_at DESC);
CREATE INDEX sync_jobs_status_idx    ON sync_jobs (status);

CREATE TRIGGER source_connectors_set_updated_at
  BEFORE UPDATE ON source_connectors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
