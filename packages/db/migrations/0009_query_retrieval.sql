-- 0009_query_retrieval.sql
-- Chat/query sessions, their messages, and retrieval logs for debugging + evaluation.

CREATE TABLE query_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id         uuid NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  title            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX query_sessions_space_idx ON query_sessions (space_id, created_at DESC);

CREATE TABLE query_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id       uuid NOT NULL REFERENCES query_sessions(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          text NOT NULL,
  citations        jsonb NOT NULL DEFAULT '[]',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX query_messages_session_idx ON query_messages (session_id, created_at);

-- One row per retrieval call (whether from chat UI or an agent tool).
CREATE TABLE retrieval_logs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id           uuid NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  user_id            uuid REFERENCES users(id) ON DELETE SET NULL,
  session_id         uuid REFERENCES query_sessions(id) ON DELETE SET NULL,
  source             text NOT NULL DEFAULT 'chat',   -- 'chat' | 'tool:<name>'
  query              text NOT NULL,
  filters            jsonb NOT NULL DEFAULT '{}',
  retrieved          jsonb NOT NULL DEFAULT '[]',    -- [{chunkId, score, documentId, page}]
  answer             text,
  citations          jsonb NOT NULL DEFAULT '[]',
  model              text,
  token_usage        jsonb NOT NULL DEFAULT '{}',
  latency_ms         int,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retrieval_logs_space_idx ON retrieval_logs (space_id, created_at DESC);

CREATE TRIGGER query_sessions_set_updated_at
  BEFORE UPDATE ON query_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
