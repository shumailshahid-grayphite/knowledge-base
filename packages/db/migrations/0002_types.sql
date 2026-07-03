-- 0002_types.sql
-- Enum types (the shared status/type vocabulary) and helper functions.
-- These enum values ARE part of the cross-service contract (see docs/CONTRACTS.md).
-- To extend later:  ALTER TYPE <name> ADD VALUE '<new>';   (safe, additive)

CREATE TYPE membership_role AS ENUM ('owner', 'admin', 'member', 'viewer');

-- Reused for source_connectors.type AND documents.source_type.
CREATE TYPE connector_type AS ENUM (
  'upload', 'gdrive', 'sharepoint', 'onedrive', 'dropbox', 'notion', 'confluence'
);

CREATE TYPE connector_status AS ENUM ('pending', 'active', 'disconnected', 'error');

CREATE TYPE sync_status AS ENUM ('queued', 'running', 'completed', 'failed', 'partial');

-- Document / version lifecycle shown in the UI.
CREATE TYPE processing_status AS ENUM (
  'uploaded', 'queued', 'processing', 'completed', 'failed', 'needs_review'
);

-- Worker job execution state (mirrored from BullMQ into Postgres).
CREATE TYPE job_status AS ENUM ('queued', 'processing', 'completed', 'failed');

-- Granular pipeline stage for progress + debugging.
CREATE TYPE processing_stage AS ENUM (
  'received', 'extract', 'normalize', 'chunk', 'embed', 'store', 'complete'
);

-- Auto-maintain updated_at on tables that have it.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
