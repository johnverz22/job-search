-- Per-job detail cache: when the connector last fetched this job's detail page/endpoint (NULL = never / not applicable).
-- Connectors that need one request per job (BambooHR, JazzHR, Jobvite, ...) reuse the stored `raw` while this is fresh.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS detail_fetched_at TIMESTAMPTZ;
