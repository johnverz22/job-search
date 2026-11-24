# Implementation Plan

Goal: direct-to-company job aggregator. Ingest from ATS public endpoints, normalize, dedupe, serve via API.
Everything runs via **Docker Compose** (see `docker-compose.yml`).

## Architecture
- `db`: Postgres (jobs, companies, sources registry)
- `redis`: queue + rate-limit/cache
- `worker`: connector runners (one module per ATS), scheduled fetch
- `api`: HTTP API for search/listing
- `discovery`: slug-discovery jobs (Common Crawl, crt.sh, career-page signature detection)

Stack: TypeScript on Node 22 (Fastify API, `pg`, `fast-xml-parser`, Vitest). One Docker image runs the `migrate`, `worker`, `api` and `cli` roles. The `discovery` service is deferred to Phase 5.

## Source registry schema
`platform`, `company_slug`, `careers_url`, `endpoint_template`, `format` (json|xml|rss|html), `last_seen`, `robots_policy`, `failure_count`

## Normalized job schema (draft)
`id`, `source_platform`, `company_slug`, `title`, `description_html`, `location[]`, `remote` (bool/enum), `department`, `employment_type`, `seniority`, `salary_min/max/currency/text`, `posted_at`, `apply_url`, `raw` (jsonb), `first_seen`, `last_seen`, `status`

## Phases
- [x] **Phase 0 - Scaffold**: stack, Dockerfile, compose (db, redis, migrate, worker, api, cli), SQL migrations. *Not yet exercised via `docker compose up`; CI not added*
- [x] **Phase 1 - Connector interface**: `Connector { discover(), list(slug), detail(job) , normalize() }`, shared HTTP client (UA string, timeouts, retries, per-host rate limit, caching with ETag/If-Modified-Since)
- [~] **Phase 2 - Top 5 keyless connectors** (code + unit tests done; *response shapes not verified live*, see 03-verification-checklist.md) (in order): Recruitee, Personio, Teamtailor, Rippling, BambooHR. Fixtures + tests per connector are in `tests/`. TODO: replace hand-written fixtures with captured live responses. TODO: Recruitee token/HTML-JSON-LD fallback before 2027-02-10
- [~] **Phase 3 - Next easy**: 
  - [x] Gem: endpoint verified (`GET https://api.gem.com/job_board/v0/{board}/job_posts/`, JSON array); fixture mirrors a real response
  - [~] Pinpoint: connector written against `postings.json`; response shape NOT verified (defensive parser)
  - [ ] Dover: **deferred**. A third-party source says Dover has no keyless public endpoint (only a keyed `/api/v1/external/` API) and its careers page `app.dover.com/jobs/{company}` is JS-rendered. The pasted `careers-page/{uuid}/jobs` endpoint could not be confirmed. Verify manually in a browser's network tab before building
- [~] **Phase 4 - HTML/JSON-LD sources**:
  - [x] Generic JSON-LD `JobPosting` extractor + link extractor (`src/jsonld.ts`), generic `htmlJsonLdConnector`
  - [~] JazzHR, Jobvite built on it; listing link patterns unverified against live pages
  - [ ] iCIMS, Taleo, Workday (POST CXS + detail GET, handle 2,000 cap by facet splitting), YC/WaaS
- [ ] **Phase 5 - Slug discovery**: Common Crawl + crt.sh scripts per host pattern; career-page signature detector; validate slugs (BambooHR redirects on invalid names); populate source registry
- [ ] **Phase 6 - Scheduling and health**: crawl cadence by company activity, failure backoff, dead-source pruning, dedupe across sources, job expiry
- [ ] **Phase 7 - API/search**: filters (remote, location, salary, department), full-text search, pagination

## Rules for crawling
- Descriptive User-Agent with contact URL; low request rates; respect robots.txt and record policy
- Treat undocumented endpoints as unstable: isolate per connector, alert on schema drift
- Do not use employer-scoped authenticated APIs (e.g. JazzHR) for cross-company aggregation

## Resume checklist (for picking up later)
1. `cp .env.example .env`
2. `docker compose up --build -d` (db, redis, migrate, worker, api)
3. Work through `docs/planning/03-verification-checklist.md`, then start at the first unchecked phase above
4. Reference endpoint details in `docs/planning/01-ats-sources.md`
