-- 0011_connector_secrets.sql
-- Encrypted OAuth credential storage for source connectors.
-- Tokens are AES-256-GCM encrypted by the API on OAuth callback and decrypted by
-- the worker at sync time. They are never stored in source_connectors directly.

CREATE TABLE connector_secrets (
  connector_id     uuid PRIMARY KEY REFERENCES source_connectors(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ciphertext       text NOT NULL,   -- base64 AES-256-GCM ciphertext of the token JSON
  iv               text NOT NULL,   -- base64 nonce
  auth_tag         text NOT NULL,   -- base64 GCM auth tag
  key_version      int  NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connector_secrets_org_idx ON connector_secrets (organization_id);

CREATE TRIGGER connector_secrets_set_updated_at
  BEFORE UPDATE ON connector_secrets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
