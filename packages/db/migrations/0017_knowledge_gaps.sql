-- Knowledge Gaps V1: record when the KB could not adequately support a question,
-- then group similar unmet questions into recurring, actionable gaps for admins.
-- Signals are derived from the EXISTING retrieval pipeline's output (no re-query).

CREATE TYPE knowledge_gap_status AS ENUM ('open', 'resolved', 'ignored');

-- A grouped, recurring gap. Its centroid is the embedding of the representative
-- (first) question; V1 keeps it fixed (future: running average / re-clustering).
CREATE TABLE knowledge_gaps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status             knowledge_gap_status NOT NULL DEFAULT 'open',
  title              text NOT NULL,                 -- representative question
  centroid_embedding vector(1536),                  -- anchor for grouping (nullable if embed unavailable)
  occurrence_count   int  NOT NULL DEFAULT 0,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz,
  resolved_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_gaps_org_idx ON knowledge_gaps (organization_id, status, last_seen_at DESC);

CREATE TRIGGER knowledge_gaps_set_updated_at
  BEFORE UPDATE ON knowledge_gaps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per question judged to have insufficient KB support. Never deleted
-- (preserves history + metrics even after a gap is resolved/ignored).
CREATE TABLE knowledge_gap_signals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  gap_id              uuid REFERENCES knowledge_gaps(id) ON DELETE SET NULL,
  session_id          uuid REFERENCES query_sessions(id) ON DELETE SET NULL,
  message_id          uuid REFERENCES query_messages(id) ON DELETE SET NULL,
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  question            text NOT NULL,                 -- the user's raw question
  standalone_question text NOT NULL,                 -- rewritten/standalone form used for retrieval + grouping
  embedding           vector(1536),
  retrieval_outcome   text NOT NULL,                 -- 'no_results' | 'weak'
  reason              text NOT NULL,                 -- 'no_relevant_knowledge' | 'weak_evidence'
  top_score           double precision,              -- strongest surviving reranker score (null when none)
  weak_matches        jsonb NOT NULL DEFAULT '[]',   -- [{documentName, score, pageNumber}] that almost matched
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_gap_signals_gap_idx ON knowledge_gap_signals (organization_id, gap_id, created_at DESC);
CREATE INDEX knowledge_gap_signals_reason_idx ON knowledge_gap_signals (organization_id, reason);

-- Tenant isolation: same fail-closed FORCE RLS policy as 0013_rls.sql.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['knowledge_gaps','knowledge_gap_signals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (organization_id = nullif(current_setting('app.current_org', true), '')::uuid)
        WITH CHECK (organization_id = nullif(current_setting('app.current_org', true), '')::uuid);
    $p$, t);
  END LOOP;
END $$;
