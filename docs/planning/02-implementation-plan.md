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
- [x] **Phase 0 - Scaffold**: stack, Dockerfile, compose (db, redis, migrate, worker, api, cli), SQL migrations. CI in `.github/workflows/ci.yml`: typecheck, ESLint (`npm run lint`), unit + DB-backed tests, worker/DB integration against a Postgres service. *Not yet exercised via `docker compose up`*
- [x] **Phase 1 - Connector interface**: `Connector { discover(), list(slug), detail(job) , normalize() }`, shared HTTP client (UA string, timeouts, retries, per-host rate limit, caching with ETag/If-Modified-Since)
- [~] **Phase 2 - Top 5 keyless connectors** (code + unit tests done; *response shapes not verified live*, see 03-verification-checklist.md) (in order): Recruitee, Personio, Teamtailor, Rippling, BambooHR. Fixtures + tests per connector are in `tests/`. TODO: replace hand-written fixtures with captured live responses. TODO: Recruitee token/HTML-JSON-LD fallback before 2027-02-10
- [~] **Phase 3 - Next easy**: 
  - [x] Gem: endpoint verified (`GET https://api.gem.com/job_board/v0/{board}/job_posts/`, JSON array); fixture mirrors a real response
  - [x] Pinpoint: VERIFIED live — `postings.json` is `{"data":[...]}` with flat fields; compensation min/max/currency now normalized (no posted-date field exists)
  - [ ] Dover: **deferred**. A third-party source says Dover has no keyless public endpoint (only a keyed `/api/v1/external/` API) and its careers page `app.dover.com/jobs/{company}` is JS-rendered. The pasted `careers-page/{uuid}/jobs` endpoint could not be confirmed. Verify manually in a browser's network tab before building
- [~] **Phase 4 - HTML/JSON-LD sources**:
  - [x] Generic JSON-LD `JobPosting` extractor + link extractor (`src/jsonld.ts`), generic `htmlJsonLdConnector`
  - [~] JazzHR, Jobvite built on it; listing link patterns unverified against live pages
  - [~] iCIMS, Taleo, Workday, YC: connectors written and unit-tested against hand-written fixtures; **none verified live** (see 03-verification-checklist.md). All four fetch one request per job, so they use the per-job detail cache.
    - iCIMS: generic JSON-LD connector over `https://{portal}.icims.com/jobs/search?ss=1&pr=N&in_iframe=1` (paginated until a page adds no new jobs); slug = portal subdomain
    - Taleo: Business Edition (`{sub}.tbe.taleo.net`) HTML results + JSON-LD; slug = `{sub}/{pod}/{org}/{cws}`. The paging parameter is a guess (fails safe to page 1 only); classic `*.taleo.net/careersection` is not supported
    - Workday: CXS `POST .../wday/cxs/{tenant}/{site}/jobs` (20 per page) + detail GET; results over the 2,000 cap are split by facet (location, job family, ...) and merged by requisition id; slug = `{tenant}.{wdN}/{site}`
    - YC: `ycombinator.com/companies/{slug}/jobs` over the generic JSON-LD connector (Work at a Startup company pages map to the same slug); robots.txt/terms not yet checked
- [~] **Phase 5 - Slug discovery**: built and unit-tested; Common Crawl ran live for pinpoint, recruitee and personio (`discover cc <platform> --pages 1 --dry` returned real slugs; `cli probe` on discovered slugs works — bamboohr's `*.bamboohr.com` CC query returned 0 on page 0, may need `--pages` tuning). crt.sh not yet run live
  - [x] URL/host -> platform+slug rules for all 9 platforms with a reserved-name filter (`src/discovery/patterns.ts`)
  - [x] Career-page detector (`discover page <url>`): finds ATS links/embeds, plus Teamtailor custom domains via `teamtailor-cdn` assets
  - [x] crt.sh and Common Crawl CDX fetchers/parsers; candidates go in `sources` as disabled + `unvalidated`
  - [x] `discover validate`: probes candidates with the real connector, enables valid ones, marks 404/403 invalid, retries transient errors up to 3x
  - [x] Import from a file of URLs (`discover urls`), e.g. exported Google results
  - [ ] Run live per platform and tune (crt.sh can time out on big domains; Common Crawl may need `--pages` tuning)
  - [~] Custom-domain detection for Recruitee/Personio/Rippling: `discover domains <file>` takes a seed list of company domains/careers URLs, scans their careers pages for ATS links/embeds (incl. Rippling's board API call) and probes the reachable hosts for Recruitee (`/api/offers/`) and Personio (`/xml`) feeds. A custom-domain slug is the full host (a slug containing a dot); the Recruitee/Personio connectors accept it. Unit-tested with fake fetchers; **not run against real sites**, and it is unknown whether every Recruitee/Personio custom domain serves those endpoints
  - [~] New-platform discovery: URL rules for iCIMS, Taleo, Workday and YC; crt.sh works for iCIMS only (Taleo/Workday/YC slugs need path or query data, so use `cc`, `urls` or `page`)
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
  - [x] Per-job detail cache (BambooHR, JazzHR, Jobvite, and the Phase 4 connectors): `jobs.detail_fetched_at` (migration 005) + the stored `raw` are loaded by the worker (`loadPrevious`) and handed to connectors that set `cachesDetail`. A crawl fetches details only for new jobs, jobs past `DETAIL_TTL_HOURS` (default 168), and (BambooHR) jobs whose list entry changed; a failed detail fetch falls back to the stored copy instead of dropping the job. Verified by unit tests, a store round-trip test and a worker integration scenario (changed crawl with one new job = one detail request). JSON-LD connectors cap *fetches* per crawl at `MAX_DETAIL_FETCH` (300), Workday at `WORKDAY_DETAIL_BUDGET` (300); jobs beyond the budget are picked up on later crawls
- [x] **Phase 7 - API/search** (query building unit-tested in `tests/query.test.ts`; endpoints tested against real Postgres via `app.inject` in `tests/api.db.test.ts`; see `05-api.md`)
  - [x] Postgres full-text search: generated weighted `tsvector` (title > department/company > description text, HTML stripped, description capped at 100k chars) + GIN index; `websearch_to_tsquery`, `ts_rank_cd` relevance sort
  - [x] Filters: `platform`, `company`, `employment_type`, `seniority` (lists), `department`, `location`, `remote=true|false`, `min_salary`/`max_salary` (+ required `salary_currency`), `has_salary`, `posted_after`, `posted_within_days`, `distinct`
  - [x] Keyset (cursor) pagination for both sorts, stable under identical and microsecond-apart timestamps; `offset` kept but deprecated
  - [x] `GET /jobs/:id` (full description, closed jobs included), `GET /openapi.json` (rendered from the same param table the parser uses), strict 400s for bad input
  - [ ] Not done: `distinct=true` sorts the whole open set (~300-400 ms at 200k rows; same cost shape as before); relevance search on very common terms scores every match (~100-150 ms at 25k matches); both fine for now, revisit if the corpus grows by an order of magnitude (e.g. a stored "primary posting" flag for distinct)
  - [ ] Not done: salary amounts are not normalized to a common period (hourly/monthly/yearly) by the connectors, so `min_salary`/`max_salary` compare raw advertised numbers within one currency; no auth or rate limiting on the API

- [~] **Phase 8 - Web UI** (spec and status in `docs/planning/06-ui-plan.md`)
  - [x] U0 decisions (internal, API under `/api`, facets yes, total count deferred); U1 backend (same-origin SPA serving, `GET /facets`, security headers)
  - [x] U2-U5: `web/` app with search, filters, job detail (sanitized HTML) and status pages; 118 unit/component tests; initial JS 101.6 kB gz
  - [x] U6 polish (dark mode, contrast-tested tokens, reduced motion, bundle budget); U7 Dockerfile + CI jobs
  - [ ] Playwright e2e at 375/768/1280 px (written, never run: no browser in the build sandbox) and a Docker image build: both first run in CI
  - [ ] U8: xl master-detail, saved jobs, company names/logos, capped total count

## Rules for crawling
- Descriptive User-Agent with contact URL; low request rates; respect robots.txt and record policy
- Treat undocumented endpoints as unstable: isolate per connector, alert on schema drift
- Do not use employer-scoped authenticated APIs (e.g. JazzHR) for cross-company aggregation

## Resume checklist (for picking up later)
1. `cp .env.example .env`
2. `docker compose up --build -d` (db, redis, migrate, worker, api)
3. Work through `docs/planning/03-verification-checklist.md` and `docs/planning/04-discovery-runbook.md`, then start at the first unchecked phase above
4. Reference endpoint details in `docs/planning/01-ats-sources.md`
