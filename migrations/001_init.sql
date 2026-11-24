CREATE TABLE IF NOT EXISTS sources (
  id SERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  company_slug TEXT NOT NULL,
  careers_url TEXT,
  endpoint_template TEXT,
  format TEXT,
  robots_policy TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  failure_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  last_seen TIMESTAMPTZ,
  last_success TIMESTAMPTZ,
  UNIQUE (platform, company_slug)
);

CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,            -- platform:slug:external_id
  platform TEXT NOT NULL,
  company_slug TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description_html TEXT,
  locations TEXT[] NOT NULL DEFAULT '{}',
  remote BOOLEAN,
  department TEXT,
  employment_type TEXT,
  seniority TEXT,
  salary_min NUMERIC,
  salary_max NUMERIC,
  salary_currency TEXT,
  salary_text TEXT,
  posted_at TIMESTAMPTZ,
  apply_url TEXT,
  raw JSONB,
  status TEXT NOT NULL DEFAULT 'open',  -- open | closed
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_source_idx ON jobs (platform, company_slug);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status, posted_at DESC);
