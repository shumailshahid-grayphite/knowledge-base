-- 0007_processing_jobs.sql
-- Mirror of worker execution into Postgres so the API/UI read status from the DB,
-- never from Redis internals. One row per processing attempt of a document version.

CREATE TABLE processing_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id      uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id       uuid NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  queue_job_id     text,                 -- BullMQ (or any queue) job id, for correlation
  stage            processing_stage NOT NULL DEFAULT 'received',
  status           job_status NOT NULL DEFAULT 'queued',
  attempts         int NOT NULL DEFAULT 0,
  error            text,
  logs_ref         text,                 -- pointer to detailed logs (object storage / log store)
  metrics          jsonb NOT NULL DEFAULT '{}',  -- {extractMs, chunkCount, tokenCount, embedMs}
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX processing_jobs_document_idx ON processing_jobs (document_id, created_at DESC);
CREATE INDEX processing_jobs_version_idx  ON processing_jobs (version_id);
CREATE INDEX processing_jobs_status_idx   ON processing_jobs (status);

CREATE TRIGGER processing_jobs_set_updated_at
  BEFORE UPDATE ON processing_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
