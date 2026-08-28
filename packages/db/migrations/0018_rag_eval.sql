-- RAG Evaluation V1: labelled question sets run against the SAME production
-- retrieval/rerank/gap path, with per-run config snapshots so old runs stay
-- interpretable after config or documents change.

CREATE TYPE rag_eval_run_status AS ENUM ('queued', 'running', 'completed', 'failed');
CREATE TYPE rag_eval_relevance AS ENUM ('primary', 'acceptable');

-- A named, per-org collection of evaluation cases.
CREATE TABLE rag_eval_datasets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rag_eval_datasets_org_idx ON rag_eval_datasets (organization_id, created_at DESC);
CREATE TRIGGER rag_eval_datasets_set_updated_at
  BEFORE UPDATE ON rag_eval_datasets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One labelled question + its expected behaviour.
CREATE TABLE rag_eval_cases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_id          uuid NOT NULL REFERENCES rag_eval_datasets(id) ON DELETE CASCADE,
  question            text NOT NULL,
  expected_answerable boolean NOT NULL DEFAULT true,
  expected_gap        boolean NOT NULL DEFAULT false,
  notes               text,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rag_eval_cases_dataset_idx ON rag_eval_cases (organization_id, dataset_id, created_at);
CREATE TRIGGER rag_eval_cases_set_updated_at
  BEFORE UPDATE ON rag_eval_cases FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Documents expected to contain the answer (references real KB documents by id).
CREATE TABLE rag_eval_case_expected_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  eval_case_id     uuid NOT NULL REFERENCES rag_eval_cases(id) ON DELETE CASCADE,
  document_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  relevance        rag_eval_relevance NOT NULL DEFAULT 'primary',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (eval_case_id, document_id)
);
CREATE INDEX rag_eval_expected_docs_case_idx ON rag_eval_case_expected_documents (organization_id, eval_case_id);

-- One execution of a dataset against the RAG config captured at run time.
CREATE TABLE rag_eval_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_id          uuid NOT NULL REFERENCES rag_eval_datasets(id) ON DELETE CASCADE,
  status              rag_eval_run_status NOT NULL DEFAULT 'queued',
  started_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  config_snapshot     jsonb NOT NULL DEFAULT '{}',   -- retrieval/rerank/gap/provider config at run time
  summary_metrics     jsonb NOT NULL DEFAULT '{}',   -- computed aggregates
  total_cases         int NOT NULL DEFAULT 0,
  succeeded_cases     int NOT NULL DEFAULT 0,
  errored_cases       int NOT NULL DEFAULT 0,
  error               text,
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rag_eval_runs_dataset_idx ON rag_eval_runs (organization_id, dataset_id, created_at DESC);

-- Per-case outcome. Snapshots the case expectations so a run stays interpretable
-- even if the case is later edited or deleted (eval_case_id SET NULL).
CREATE TABLE rag_eval_results (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id                      uuid NOT NULL REFERENCES rag_eval_runs(id) ON DELETE CASCADE,
  eval_case_id                uuid REFERENCES rag_eval_cases(id) ON DELETE SET NULL,
  -- snapshot of the labelled case at run time
  question                    text NOT NULL,
  expected_answerable         boolean NOT NULL,
  expected_gap                boolean NOT NULL,
  expected_documents          jsonb NOT NULL DEFAULT '[]',   -- [{documentId, documentName, relevance}]
  -- preserved retrieval: full pre-threshold ranking + post-threshold survivors
  retrieval                   jsonb NOT NULL DEFAULT '{}',   -- {ranked:[...], survivors:[...], topScore, minScore}
  top_score                   double precision,
  expected_document_found     boolean,
  expected_document_best_rank int,
  actual_answerable           boolean,
  actual_gap                  boolean,
  gap_reason                  text,
  error                       text,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rag_eval_results_run_idx ON rag_eval_results (organization_id, run_id);

-- Tenant isolation: identical FORCE RLS tenant_isolation policy as 0013/0017.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rag_eval_datasets','rag_eval_cases','rag_eval_case_expected_documents',
    'rag_eval_runs','rag_eval_results'
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
