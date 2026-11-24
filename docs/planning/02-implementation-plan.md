# Implementation Plan

Goal: direct-to-company job aggregator. Ingest from ATS public endpoints, normalize, dedupe, serve via API.
Everything runs via **Docker Compose** (see `docker-compose.yml`).

## Architecture
- `db`: Postgres (jobs, companies, sources registry)
- `redis`: queue + rate-limit/cache
- `worker`: connector runners (one module per ATS), scheduled fetch
- `api`: HTTP API for search/listing
- `discovery`: slug-discovery jobs (Common Crawl, crt.sh, career-page signature detection)

Language/stack is not yet decided; compose services use placeholders (`./services/*`). Pick one (suggest TypeScript/Node or Python) and fill the Dockerfiles.

## Source registry schema
`platform`, `company_slug`, `careers_url`, `endpoint_template`, `format` (json|xml|rss|html), `last_seen`, `robots_policy`, `failure_count`

## Normalized job schema (draft)
`id`, `source_platform`, `company_slug`, `title`, `description_html`, `location[]`, `remote` (bool/enum), `department`, `employment_type`, `seniority`, `salary_min/max/currency/text`, `posted_at`, `apply_url`, `raw` (jsonb), `first_seen`, `last_seen`, `status`

## Phases
- [ ] **Phase 0 - Scaffold**: pick stack, Dockerfiles, `docker compose up` brings db+redis+worker+api healthy, migrations, CI
- [ ] **Phase 1 - Connector interface**: `Connector { discover(), list(slug), detail(job) , normalize() }`, shared HTTP client (UA string, timeouts, retries, per-host rate limit, caching with ETag/If-Modified-Since)
- [ ] **Phase 2 - Top 5 keyless connectors** (in order): Recruitee, Personio, Teamtailor, Rippling, BambooHR. Fixtures + contract tests per connector. Recruitee: add token/HTML-JSON-LD fallback before 2027-02-10
- [ ] **Phase 3 - Next easy**: Pinpoint, Dover (resolve board UUID), Gem (verify endpoint live)
- [ ] **Phase 4 - HTML/JSON-LD sources**: generic JSON-LD `JobPosting` extractor; then JazzHR, Jobvite, iCIMS, Taleo, Workday (POST CXS + detail GET, handle 2,000 cap by facet splitting), YC/WaaS
- [ ] **Phase 5 - Slug discovery**: Common Crawl + crt.sh scripts per host pattern; career-page signature detector; validate slugs (BambooHR redirects on invalid names); populate source registry
- [ ] **Phase 6 - Scheduling and health**: crawl cadence by company activity, failure backoff, dead-source pruning, dedupe across sources, job expiry
- [ ] **Phase 7 - API/search**: filters (remote, location, salary, department), full-text search, pagination

## Rules for crawling
- Descriptive User-Agent with contact URL; low request rates; respect robots.txt and record policy
- Treat undocumented endpoints as unstable: isolate per connector, alert on schema drift
- Do not use employer-scoped authenticated APIs (e.g. JazzHR) for cross-company aggregation

## Resume checklist (for picking up later)
1. `cp .env.example .env`
2. `docker compose up -d db redis`
3. Start at the first unchecked phase above
4. Reference endpoint details in `docs/planning/01-ats-sources.md`
