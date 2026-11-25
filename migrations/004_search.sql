-- Phase 7: full-text search + keyset pagination support. Idempotent (migrate.ts re-runs every file).
-- NOTE: adding a STORED generated column rewrites the jobs table once; run during a quiet window on a large table.

-- Weighted search vector: title (A) > department + company (B) > description text (C).
-- The description is HTML, so tags and entities are stripped first, and capped at 100k chars so one huge
-- posting can never exceed tsvector's size limit and fail the crawler's INSERT.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS search_tsv tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english'::regconfig, coalesce(department, '') || ' ' || replace(company_slug, '-', ' ')), 'B') ||
  setweight(to_tsvector('english'::regconfig,
    regexp_replace(regexp_replace(left(coalesce(description_html, ''), 100000), '<[^>]*>', ' ', 'g'), '&[#a-zA-Z0-9]+;', ' ', 'g')), 'C')
) STORED;
CREATE INDEX IF NOT EXISTS jobs_search_idx ON jobs USING GIN (search_tsv);

-- Non-null sort key: posted_at when known, otherwise when we first saw the job. Gives a total order for cursors.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS sort_ts TIMESTAMPTZ GENERATED ALWAYS AS (coalesce(posted_at, first_seen)) STORED;
CREATE INDEX IF NOT EXISTS jobs_open_sort_idx ON jobs (sort_ts DESC, id DESC) WHERE status = 'open';

-- Salary range filters only look at rows that actually have salary data.
CREATE INDEX IF NOT EXISTS jobs_open_salary_idx ON jobs (salary_currency, salary_max) WHERE status = 'open' AND (salary_min IS NOT NULL OR salary_max IS NOT NULL);
