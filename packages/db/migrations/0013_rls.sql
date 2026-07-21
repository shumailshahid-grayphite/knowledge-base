-- 0013_rls.sql
-- Arm tenant isolation as defense-in-depth: a non-superuser runtime role + RLS.
--
-- Superusers BYPASS row-level security, so migrations/seed keep using the admin
-- role (DATABASE_URL) while the API/worker connect as this non-superuser role
-- (APP_DATABASE_URL) which RLS actually applies to. Each request/job sets
-- `app.current_org`; the policy scopes every tenant table to that org.
--
-- Dev password below is intentionally simple — ROTATE it for any real deployment.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'kb_app') THEN
    CREATE ROLE kb_app LOGIN PASSWORD 'kb_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- Runtime role can read/write data but owns nothing (so FORCE RLS binds it).
GRANT USAGE ON SCHEMA public TO kb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kb_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO kb_app;
-- Future tables/sequences created by the migration runner are reachable too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO kb_app;

-- Enable + FORCE RLS (FORCE so even a table owner is subject) with a fail-closed
-- policy: no/empty app.current_org -> NULL -> zero rows.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'knowledge_spaces','folders','source_connectors','sync_jobs',
    'documents','document_versions','processing_jobs','chunks',
    'query_sessions','query_messages','retrieval_logs','audit_logs',
    'connector_secrets'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (organization_id = nullif(current_setting('app.current_org', true), '')::uuid)
        WITH CHECK (organization_id = nullif(current_setting('app.current_org', true), '')::uuid);
    $p$, t);
  END LOOP;
END $$;
