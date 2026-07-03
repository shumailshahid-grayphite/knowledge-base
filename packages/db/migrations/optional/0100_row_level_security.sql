-- OPTIONAL / NOT AUTO-APPLIED (lives in migrations/optional/, skipped by the runner).
-- Defense-in-depth tenant isolation via Postgres Row-Level Security.
--
-- Primary isolation is enforced in the application (every query is org-scoped in a
-- base repository/guard). RLS is a second wall for when a client demands it.
--
-- To use it, the app/worker MUST set the tenant on every connection/transaction:
--     SET app.current_org = '<organization-uuid>';
-- and connect as a role that does NOT own the tables (owners bypass RLS).
-- The worker, which processes across tenants, should set app.current_org per job.
--
-- Apply manually:  psql "$DATABASE_URL" -f migrations/optional/0100_row_level_security.sql

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'knowledge_spaces','folders','source_connectors','sync_jobs',
    'documents','document_versions','processing_jobs','chunks',
    'query_sessions','query_messages','retrieval_logs','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (organization_id = current_setting('app.current_org', true)::uuid)
        WITH CHECK (organization_id = current_setting('app.current_org', true)::uuid);
    $p$, t);
  END LOOP;
END $$;
