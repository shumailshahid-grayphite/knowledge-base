-- 0012_folders_kb.sql
-- Make folders first-class for the folder-centric KB:
--   * provenance (user- vs connector-created) so a sync can't clobber manual folders
--   * one folder per materialized path within a space (idempotent connector upserts,
--     and no accidental duplicate "HR" folders)
--   * updated_at for move/rename tracking

ALTER TABLE folders ADD COLUMN origin text NOT NULL DEFAULT 'user';
ALTER TABLE folders ADD CONSTRAINT folders_origin_chk CHECK (origin IN ('user', 'connector'));
ALTER TABLE folders ADD COLUMN source_connector_id uuid REFERENCES source_connectors(id) ON DELETE SET NULL;
ALTER TABLE folders ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Materialized path is unique per space: enables ON CONFLICT upserts from the
-- connector sync (many files resolving the same folder path concurrently) and
-- blocks duplicate manual folders.
CREATE UNIQUE INDEX folders_space_path_uniq ON folders (space_id, path);

CREATE TRIGGER folders_set_updated_at
  BEFORE UPDATE ON folders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
