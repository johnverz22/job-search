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
- [~] **Phase 5 - Slug discovery**: built and unit-tested; the crt.sh and Common Crawl fetchers are NOT yet run live
  - [x] URL/host -> platform+slug rules for all 9 platforms with a reserved-name filter (`src/discovery/patterns.ts`)
  - [x] Career-page detector (`discover page <url>`): finds ATS links/embeds, plus Teamtailor custom domains via `teamtailor-cdn` assets
  - [x] crt.sh and Common Crawl CDX fetchers/parsers; candidates go in `sources` as disabled + `unvalidated`
  - [x] `discover validate`: probes candidates with the real connector, enables valid ones, marks 404/403 invalid, retries transient errors up to 3x
  - [x] Import from a file of URLs (`discover urls`), e.g. exported Google results
  - [ ] Run live per platform and tune (crt.sh can time out on big domains; Common Crawl may need `--pages` tuning)
  - [ ] Custom-domain detection for Recruitee/Personio/Rippling (needs a crawl of company career pages, seeded from a company list)
- [x] **Phase 6 - Scheduling and health** (SQL verified against real Postgres via `tests/integration/worker.sh`)
  - [x] Per-source `next_run_at` with leases (`FOR UPDATE SKIP LOCKED`): crashed workers' sources return after `LEASE_MINUTES`; multiple workers can run in parallel
  - [x] Bounded concurrency (`WORKER_CONCURRENCY`, default 4); graceful SIGTERM drain; fixed a per-host throttle race in `http.ts` that concurrency exposed
  - [x] Adaptive intervals: x2 per 2 unchanged crawls up to `MAX_INTERVAL_HOURS`; failures back off x2 up to 7 days; +-10% jitter
  - [x] Change detection via content hash: unchanged crawls skip the DB rewrite (just refresh `last_seen`)
  - [x] Dead-source pruning: 3 consecutive 404/410 -> disabled `gone`; `MAX_FAILURES` consecutive failures -> `too_many_failures`
  - [x] Within-company dedupe key (`company|title|locations`), exposed as `GET /jobs?distinct=true`
  - [x] Maintenance (hourly): close jobs of sources not crawled successfully for `STALE_DAYS`; purge jobs closed for `RETENTION_DAYS`
  - [x] `GET /stats`: jobs per platform, sources per state, due queue size
  - [ ] Not done: per-host concurrency caps across multiple worker processes (the host throttle is per process, so run one worker per host group or keep concurrency modest); true cross-platform company identity (no company entity yet, so the same company on two ATSes is not merged)
  - [ ] Not done: BambooHR/JazzHR/Jobvite still re-fetch every job detail on a changed crawl; add a per-job detail cache
- [x] **Phase 7 - API/search** (query building unit-tested in `tests/query.test.ts`; endpoints tested against real Postgres via `app.inject` in `tests/api.db.test.ts`; see `05-api.md`)
  - [x] Postgres full-text search: generated weighted `tsvector` (title > department/company > description text, HTML stripped, description capped at 100k chars) + GIN index; `websearch_to_tsquery`, `ts_rank_cd` relevance sort
  - [x] Filters: `platform`, `company`, `employment_type`, `seniority` (lists), `department`, `location`, `remote=true|false`, `min_salary`/`max_salary` (+ required `salary_currency`), `has_salary`, `posted_after`, `posted_within_days`, `distinct`
  - [x] Keyset (cursor) pagination for both sorts, stable under identical and microsecond-apart timestamps; `offset` kept but deprecated
  - [x] `GET /jobs/:id` (full description, closed jobs included), `GET /openapi.json` (rendered from the same param table the parser uses), strict 400s for bad input
  - [ ] Not done: `distinct=true` sorts the whole open set (~300-400 ms at 200k rows; same cost shape as before); relevance search on very common terms scores every match (~100-150 ms at 25k matches); both fine for now, revisit if the corpus grows by an order of magnitude (e.g. a stored "primary posting" flag for distinct)
  - [ ] Not done: salary amounts are not normalized to a common period (hourly/monthly/yearly) by the connectors, so `min_salary`/`max_salary` compare raw advertised numbers within one currency; no auth or rate limiting on the API

## Rules for crawling
- Descriptive User-Agent with contact URL; low request rates; respect robots.txt and record policy
- Treat undocumented endpoints as unstable: isolate per connector, alert on schema drift
- Do not use employer-scoped authenticated APIs (e.g. JazzHR) for cross-company aggregation

## Resume checklist (for picking up later)
1. `cp .env.example .env`
2. `docker compose up --build -d` (db, redis, migrate, worker, api)
3. Work through `docs/planning/03-verification-checklist.md` and `docs/planning/04-discovery-runbook.md`, then start at the first unchecked phase above
4. Reference endpoint details in `docs/planning/01-ats-sources.md`
