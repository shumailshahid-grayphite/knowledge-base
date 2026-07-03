-- 0010_audit.sql
-- Append-only audit trail for mutating actions and sensitive reads.

CREATE TABLE audit_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  action           text NOT NULL,            -- e.g. 'document.upload', 'connector.sync'
  target_type      text,                     -- e.g. 'document', 'space', 'connector'
  target_id        uuid,
  meta             jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_idx    ON audit_logs (organization_id, created_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id);
