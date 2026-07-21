-- 0014_rename_knowledge_base.sql
-- The product has one implicit knowledge base per org; make the schema say so.
-- Rename knowledge_spaces -> knowledge_base and every space_id -> knowledge_base_id.
-- FKs, indexes, RLS enablement and policies follow the table/columns by OID, so
-- no policy or constraint needs recreating. External HTTP routes / DTO field
-- names keep the legacy "space" vocabulary for API stability.

ALTER TABLE knowledge_spaces RENAME TO knowledge_base;

ALTER TABLE folders        RENAME COLUMN space_id TO knowledge_base_id;
ALTER TABLE sync_jobs      RENAME COLUMN space_id TO knowledge_base_id;
ALTER TABLE documents      RENAME COLUMN space_id TO knowledge_base_id;
ALTER TABLE chunks         RENAME COLUMN space_id TO knowledge_base_id;
ALTER TABLE query_sessions RENAME COLUMN space_id TO knowledge_base_id;
ALTER TABLE retrieval_logs RENAME COLUMN space_id TO knowledge_base_id;
