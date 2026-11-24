ALTER TABLE sources ADD COLUMN IF NOT EXISTS validation_status TEXT NOT NULL DEFAULT 'manual'; -- manual | unvalidated | valid | invalid
ALTER TABLE sources ADD COLUMN IF NOT EXISTS validation_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS jobs_found INT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS discovered_via TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS sources_validation_idx ON sources (validation_status);
