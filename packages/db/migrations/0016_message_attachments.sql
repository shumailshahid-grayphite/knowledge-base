-- Record ephemeral attachment metadata (name only) per chat message, so a
-- reloaded conversation can show that a draft was attached to a turn. The draft
-- TEXT itself is never stored — it lives only in that request's prompt.
ALTER TABLE query_messages
  ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]';
