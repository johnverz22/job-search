ALTER TABLE sources ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE sources ADD COLUMN IF NOT EXISTS unchanged_count INT NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS permanent_failures INT NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS snapshot_hash TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_job_count INT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS disabled_reason TEXT;
CREATE INDEX IF NOT EXISTS sources_due_idx ON sources (next_run_at) WHERE enabled;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
CREATE INDEX IF NOT EXISTS jobs_dedupe_idx ON jobs (dedupe_key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS jobs_closed_idx ON jobs (last_seen) WHERE status = 'closed';
