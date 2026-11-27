# Plan: single-process monolith, no database

Branch: `monolith/no-db` (off `main`; `main` is tagged `db-architecture` so the Postgres version is always recoverable).
Status: **S1-S7 done; S8 and S9 (optional) not started.** Not yet verified live: see section 9. Each session below is written to be run on its own, in a fresh conversation, without having seen the others. Read sections 1-3 first, then only your session.

## 1. What changes

One Node process that crawls a list of sources, keeps every job **in memory**, and serves the API and the built web UI on one port. No Postgres, no worker, no queue, no migrations.

| | Before (`main`) | After (this branch) |
|---|---|---|
| Source list | `sources` table, managed via CLI | `data/sources.json`, committed to git |
| Crawling | separate worker + scheduler + leases | in-process loop inside the server |
| Storage | Postgres (`jobs`, snapshots, FTS) | `Map` in memory (+ optional snapshot file) |
| Search | Postgres full text | in-memory index, same query parameters |
| Discovery | writes candidate rows | writes `data/sources.json` after validating |
| Deploy | compose: db + worker + api | one web service: `npm ci && npm run build`, `npm start` |

**Kept as is:** all connectors, `src/http.ts`, `src/jsonld.ts`, the per-job detail cache (fed from memory instead of the DB), `src/discovery/{patterns,sources,customDomains}.ts`, the whole `web/` app, the API's JSON shapes (the UI should need no changes beyond the optional banner in S4).

## 2. Honest consequences (read before committing to this)

- **Cold start = empty list.** A restart or redeploy loses every job until the first crawl finishes. Mitigations: an optional on-disk snapshot loaded at boot (S3), and a "still collecting" banner (S4).
- **Render free instances spin down when idle** and wake with an empty process, so every wake-up re-crawls. Use an always-on instance for real use, or keep the source list small.
- **Vercel is not a fit for live crawling.** Functions are short-lived and stateless, so memory does not persist between requests and a crawl will not fit a function's time limit. If you need Vercel later, the workable shape is a scheduled job (e.g. GitHub Action) that crawls and commits/bakes a `snapshot.json` that the app serves read-only. That is S8, optional, and not part of the main plan.
- **`first_seen` resets on restart** unless the snapshot file survives. Jobs without a `posted_at` then look "new". (Acceptable; documented.)
- **Search behaviour will differ from Postgres.** No Postgres stemming or ranking, so relevance is our own scoring (S2 defines it). Results for the same query will not be identical to `main`.
- **Memory is the limit.** Budget roughly 3-10 kB per job after caps; 50k jobs is a few hundred MB. S3 caps descriptions and reports RSS in `/api/stats`.
- **Shared hosting IPs** (Render) may be rate-limited or blocked by some ATS hosts that did not mind your machine.
- No more per-job history, closed-job records, or "last seen" across restarts. A job is simply present or absent.

## 3. Shared contracts (every session codes against these; do not change them without updating this file)

### 3.1 Files and ownership (to avoid merge conflicts)
| Path | Owner session |
|---|---|
| `src/model.ts`, `src/sources.ts`, `data/sources.json` | S1 |
| `src/query.ts` (parse only), `src/search.ts`, `src/facets.ts` | S2 |
| `src/aggregator.ts`, `src/snapshot.ts` | S3 |
| `src/app.ts`, `src/server.ts`, `src/openapi.ts`, `web/src/**` banner only | S4 |
| `src/discover.ts`, `src/cli.ts`, `src/discovery/{validate,sourceList}.ts` | S5 |
| everything deleted/packaging: `Dockerfile`, `render.yaml`, `.github/**`, `package.json`, `docker-compose.yml`, `web/e2e/serve.mjs`, `migrations/`, DB tests | S6 |
| `README.md`, `docs/**` | S7 |

### 3.2 Types (`src/model.ts`, created in S1)
```ts
import type { Platform } from './types.js';

export interface SourceEntry { platform: Platform; slug: string; note?: string }

export interface JobRecord {
  id: string;                 // 12 lowercase hex chars: sha1(key).slice(0, 12). Stable across restarts.
  key: string;                // `${platform}:${companySlug}:${externalId}`
  platform: Platform; companySlug: string; externalId: string;
  title: string; locations: string[]; remote: boolean | null;
  department: string | null; employmentType: string | null; seniority: string | null;
  salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null; salaryText: string | null;
  postedAt: string | null;    // ISO
  applyUrl: string | null;
  descriptionHtml: string | null;   // capped at 100 kB
  firstSeen: string; lastSeen: string;   // ISO
  dedupeKey: string;          // from src/hash.ts dedupeKey()
  sortTs: number;             // ms epoch of postedAt, else firstSeen (this is what "newest" sorts by)
  search: { title: string; department: string; company: string; body: string }; // lowercased; body = tag-stripped description, max 20,000 chars
  raw: unknown; detailFetchedAt: string | null;       // feeds the per-job detail cache (ctx.previous)
}

export type SourceStatus = 'pending' | 'ok' | 'failing' | 'invalid';
export interface SourceState {
  platform: Platform; slug: string; status: SourceStatus; jobs: number;
  lastAttemptAt: string | null; lastOkAt: string | null; lastError: string | null;
  failures: number; nextDueAt: string;
}

/** What S2 (search) and S4 (HTTP) need from S3 (crawler). S4 may develop against a fake implementation. */
export interface Aggregator {
  all(): readonly JobRecord[];          // stable array between mutations; replaced (not mutated) on change
  get(id: string): JobRecord | undefined;
  version(): number;                    // increments on every change; used as a cache key for facets/stats
  states(): readonly SourceState[];
  progress(): { ready: boolean; total: number; done: number };   // ready = every source attempted once
  start(): void; stop(): Promise<void>;
}
```
Also exported from `model.ts`: `jobId(key: string): string`, `toRecord(j: NormalizedJob, prev?: JobRecord, now?: Date): JobRecord` (preserves `firstSeen` from `prev`, computes `sortTs`, `search`, `dedupeKey`, caps sizes).

### 3.3 Sources file (`data/sources.json`)
`{ "sources": [ { "platform": "gem", "slug": "superblocks" }, ... ] }`. Loaded by `loadSources(path?)` in `src/sources.ts` (default `data/sources.json`, override with `SOURCES_FILE`). It validates the platform against `PLATFORMS`, trims, drops exact duplicates, and throws a readable error naming the entry. Seed it with the three sources already in use: `gem/superblocks`, `personio/aiya-europe`, `pinpoint/safetywing`.

### 3.4 HTTP API (unchanged shapes, all under `/api`)
`GET /api/jobs`, `/api/jobs/:id`, `/api/facets`, `/api/stats`, `/api/openapi.json`; `GET /health` at the root. Row shape is today's (snake_case, `salary_min`/`salary_max` as strings or null, `relevance` only when sorting by relevance). Differences, all deliberate:
- `relevance` is present only when sorting by relevance (the Postgres version also sent it for `q` with `sort=newest`).
- `/api/facets` is sent `no-store` until the first crawl is done.
- `id` is the 12-hex string; `/api/jobs/:id` returns 400 `invalid_id` for anything else and 404 `not_found` for an unknown id.
- `status` in the detail response is always `"open"`; `stats.jobs[].closed` is always `0`.
- `/api/stats` keeps `{ jobs, sources, queue }` and adds `crawl: { ready, total, done }` and `memory_mb`. `sources[].state` uses `ok | pending | failing | invalid`; `queue.due` is the number of sources due now, `queue.oldest_due` the earliest `nextDueAt` that is in the past (else null).
- Cursor format v2: base64url JSON `{ v: 2, s: 'relevance'|'newest', f: <12-char filter fingerprint>, t: <number, sortTs>, r?: <number, relevance>, i: <12-hex id> }`. Same misuse errors as today (wrong sort, wrong filters, malformed).

### 3.5 Search semantics (`src/search.ts`, S2)
- Word terms match at the start of a word; terms of one or two characters must match a whole word (otherwise `c++` would match every word starting with `c`). `or` has lower precedence than the implicit AND.
- Parameters, validation and error messages: unchanged from `parseJobsQuery` (only the cursor decoder changes).
- Text query: lowercase, split on non-alphanumerics, drop stop words, light suffix stripping (`s`, `es`, `ing`, `ed`) on both query and text. All positive terms must match (AND); `or` between terms makes either side suffice; `"quoted phrase"` is a case-insensitive substring match on the field text; `-term` excludes. A query that is only stop words returns an empty page (the UI already explains this).
- Relevance score: sum over terms of `4 * title + 2 * department + 2 * company + 1 * body` hits (hit = prefix match after stripping, body hits capped at 5 per term), plus a flat bonus of 3 for a phrase that matches the title. Sort: `relevance desc, sortTs desc, id desc`. `newest`: `sortTs desc, id desc`.
- `distinct=true`: keep one job per `dedupeKey`, the one that sorts first.
- Filters behave exactly as the parameter descriptions in `JOB_PARAMS` say (substring/exact/case rules unchanged).

## 4. Sessions

Each session: start from `monolith/no-db`, work on its own sub-branch `monolith/sN-name` if running in parallel, merge back when green. Tests must pass on their own (`npm test` for backend, `npm test --prefix web` for the UI). Do not edit files owned by another session; if a contract needs to change, change section 3 here in the same commit and say so.

### S1 - Contracts, sources file, record builder (small; do first)
**Status: done.** Beyond the contract, `src/model.ts` also exports `jobKey()`, `isJobId()`, `ID_PATTERN`, `htmlToSearchText()`, `MAX_DESCRIPTION_CHARS` (100,000) and `MAX_BODY_CHARS` (20,000); `src/sources.ts` exports `parseSources(text, origin)`, `loadSources(path?)`, `sourcesPath()`, `DEFAULT_SOURCES_FILE` and `SourcesError`. A description cut mid-tag by the cap does not leak tag attributes into the search body. `salaryCurrency` is upper-cased in the record. Tests: `tests/model.test.ts`, `tests/sources.test.ts`.
- **Goal:** unblock everyone else.
- **Do:** create `src/model.ts` (types, `jobId`, `toRecord`), `src/sources.ts` (`loadSources`), `data/sources.json` with the three seeds.
- **Tests:** `toRecord` keeps `firstSeen` from `prev`, sets `sortTs` from `postedAt` else `firstSeen`, strips tags into `search.body`, caps `descriptionHtml` (100 kB) and `body` (20k), stable `jobId`; `loadSources` accepts a valid file and rejects an unknown platform, a missing slug, bad JSON (message names the entry).
- **Done when:** `npm test` and `npm run typecheck` pass; nothing else in the repo changed.

### S2 - In-memory search engine (medium; independent of S3/S4)
**Status: done.** `searchJobs` returns `{ rows, nextCursor }` and `toPage` builds the response. No search index: text queries scan descriptions (measured numbers in `05-api.md`; over the 100 ms target at 50k jobs).
- **Goal:** replace Postgres query building with pure functions over `readonly JobRecord[]`.
- **Do:** in `src/query.ts` keep `JOB_PARAMS`, `parseJobsQuery`, `filterFingerprint`, and update the cursor to v2 (section 3.4); delete the SQL builder and `DETAIL_SQL`. New `src/search.ts`: `searchJobs(all, query) -> { rows, nextCursor }`, `toListRow(rec, relevance?)`, `toDetailRow(rec)`. Rewrite `src/facets.ts` as `computeFacets(all)` (same shape and 50-value cap as today; location unnested; currency upper-cased) with a small cache keyed by `version`.
- **Tests (the spec is `tests/api.db.test.ts` on `main`: port its cases):** each filter, substring/exact semantics, `%`/`_` literal, ranking order, phrase/exclude/or, stop-word-only query, distinct (incl. null-ish keys), full cursor walks matching an independent sort (ties on identical `sortTs`), cursor misuse errors, hostile `q` (very long, regex characters, unicode), 50k-job performance sanity (a search should stay well under 100 ms; record the number).
- **Done when:** a test file builds 20k synthetic records and every case above passes with no Postgres.

### S3 - Aggregator / crawler (medium-large; independent of S2/S4)
**Status: done.** `raw` is kept only for connectors with a detail cache, to save memory. The snapshot is gzipped JSON lines (one object per line), not one JSON document. A snapshot is loaded inside `start()`, so the server listens first. Duplicate job ids from a connector collapse. A permanently failing (`invalid`) source also loses its jobs after `STALE_HOURS`, checked at its daily retry.
- **Goal:** a background loop that keeps the in-memory index fresh.
- **Do:** `src/aggregator.ts` implementing `Aggregator` for a `SourceEntry[]` and a connectors map (injectable for tests).
  - Concurrency `CRAWL_CONCURRENCY` (default 4); per-source interval `REFRESH_MINUTES` (default 60) with ±10% jitter; failure backoff `min(interval * 2^failures, 6h)`; permanent HTTP errors (400/401/403/404/410) mark the source `invalid` and retry daily.
  - A successful crawl **replaces** that source's jobs (so removed postings vanish); `firstSeen` is kept for keys that existed. A source failing for `STALE_HOURS` (default 72) loses its jobs.
  - Passes `ctx.previous` (built from the source's current records' `raw` and `detailFetchedAt`) so the per-job detail cache keeps working.
  - Publishes a new `all()` array and bumps `version()` after each source finishes, not once at the end (so results appear progressively).
  - `src/snapshot.ts`: optional `SNAPSHOT_FILE`; write (gzip JSON) at most every 30 s after changes and on shutdown; load on boot, marking loaded jobs as due for refresh. A corrupt snapshot is ignored with a warning.
  - `stop()` finishes in-flight crawls (with a timeout) and flushes the snapshot.
- **Tests (fake connectors, fake clock):** progressive publication, replace-on-success, firstSeen preserved, removed job disappears, backoff growth and cap, invalid-source handling, stale drop, detail cache receives `previous`, concurrency limit respected, snapshot round trip and corrupt-file tolerance, `stop()` drains.
- **Done when:** a test with 30 fake sources of varying behaviour reaches `ready` and a consistent index.

### S4 - HTTP server and entrypoint (medium; can start against a fake `Aggregator`)
**Status: done.** The status page also needed changes (it counted the old `active` state), which the plan had not foreseen. `src/api.ts` was removed here.
- **Goal:** serve the API and the SPA from the aggregator.
- **Do:** rewrite `src/app.ts` so routes read from an `Aggregator` + S2 functions (keep `buildServer`, the SPA fallback, CSP and security headers, `/health`); add `crawl` and `memory_mb` to `/api/stats`; update `src/openapi.ts` (ids, stats, cursor wording, search syntax description). New `src/server.ts` entrypoint: load sources, create the aggregator, listen on `PORT` (default 8080) at `0.0.0.0`, graceful shutdown on SIGTERM. `/health` returns 200 immediately (the process is up even if still crawling).
- **UI (small):** when `stats.crawl.ready` is false, show a "Still collecting jobs (done/total sources)" notice above the results (and in the empty state), polling `/api/stats` every 5 s until ready. Only touch `web/src` for this.
- **Tests:** route tests with a fake aggregator (all shapes, status codes, invalid/unknown id, cursor errors, headers, SPA fallback unchanged), openapi stays in sync with `JOB_PARAMS`, UI component test for the banner.
- **Done when:** `node dist/server.js` with the seeded sources serves the UI and live data (needs network; if the sandbox has none, run against fake connectors via an env switch and say so).

### S5 - Discovery CLI writes the sources file (medium; independent)
**Status: done.** `--limit` (default 100) caps probes per run, since discovery can return thousands. `--dry` also skips probing. `validate` is no longer a command. Candidates already listed are not probed again.
- **Goal:** keep discovery, drop the database.
- **Do:** rewrite `src/discover.ts` and `src/cli.ts`. Commands keep their names (`crtsh`, `cc`, `urls`, `page`, `domains`) and gain `validate`-on-add: each candidate is probed with its connector (bounded concurrency, existing per-host politeness) and, if it returns a well-formed board (0 jobs allowed, flagged in the output), is merged into `data/sources.json` sorted by platform then slug with duplicates removed. `--dry` prints and writes nothing. `cli add <platform> <slug>` validates then appends; `cli probe` unchanged; add `cli remove` and `cli list`. New `src/discovery/validate.ts` holds the probe logic (reuse the invalid/retry classification from the old `validateBatch`). Delete `src/discovery/store.ts`.
- **Tests:** merge is idempotent and sorted, `--dry` writes nothing, invalid candidates are reported not written, permanent vs transient failure classification, file stays valid for `loadSources`.
- **Done when:** the pure discovery modules and the new CLI are tested with fake connectors/fetchers. Never claim a live run unless one happened.

### S6 - Teardown and packaging (medium; do after S2-S5 are merged)
**Status: done.** Added `render.yaml`, `scripts/dev.mjs` and `build:server`. CI also runs on pushes to `monolith/no-db`. Section 7 was not answered; the defaults chosen are listed there. Docker image and Render deploy not tried.
- **Do:** delete `src/{db,migrate,store,worker,schedule,maintenance,api}.ts`, `migrations/`, `tests/integration/`, `tests/{api.db,store.db,schedule}.test.ts`, the `pg` dependency and `@types/pg`, the Postgres/Redis/worker services in `docker-compose.yml` (keep a single `app` service). `package.json`: `build` builds the web app then compiles (`npm ci --prefix web && npm run build --prefix web && tsc`), `start` = `node dist/server.js`, `dev` runs both. New `render.yaml` (web service, build/start commands, `/health` check, env vars below). Update the `Dockerfile` (no DB, serves `web/dist`). CI: remove the Postgres service and integration step; the e2e job seeds the app by starting the server with fake connectors (rewrite `web/e2e/serve.mjs` to preload a deterministic dataset through an injected aggregator, same ids/titles the specs expect or update the specs). Update `.env.example`.
- **Env vars:** `PORT`, `SOURCES_FILE`, `REFRESH_MINUTES`, `CRAWL_CONCURRENCY`, `STALE_HOURS`, `SNAPSHOT_FILE`, `DETAIL_TTL_HOURS`, `MAX_DETAIL_FETCH`, `WORKDAY_DETAIL_BUDGET`, `CRAWLER_USER_AGENT`.
- **Done when:** a fresh clone with no database installs, builds, passes lint, typecheck and tests, and `npm start` serves the UI; `grep -ri "pg\b\|postgres\|DATABASE_URL" src package.json` finds nothing.

### S7 - Docs and verification (small-medium; last)
**Status: done.** Runbook in section 8, verification record in section 9. No live crawl: the build environment cannot reach ATS hosts.
- **Do:** rewrite `README.md` for the monolith; mark `02-implementation-plan.md`, `04-discovery-runbook.md` and `05-api.md` as partly superseded (point to this file) and fix what is wrong, including the `/api` paths and the search semantics; add a Render deploy runbook (steps, env vars, free-tier cold-start warning, how to add sources and redeploy); update the verification checklist.
- **Verify:** full clean install, lint, typecheck, tests on both packages, bundle budget, a real `npm start` against fake connectors, and (only if network is available) a live crawl of the three seed sources. State plainly what was and was not run.

### S8 - Optional: Vercel-compatible snapshot mode
Only if you want Vercel. A scheduled GitHub Action runs the aggregator once (`npm run crawl`), writes `data/snapshot.json`, and the deploy serves it read-only (no background loop; `ready` is always true). Separate branch, separate plan; do not start before S7.

### S9 - Optional later
Persisted snapshot on a Render disk, relevance tuning from real queries, `first_seen` persistence, tolerance for ATS rate limits (per-host concurrency), a "sources" admin page.

## 5. Order and parallelism

`S1` first (about an hour of work). Then `S2`, `S3`, `S5` can run in parallel, and `S4` can start against a fake aggregator at the same time. `S6` needs S2-S5 merged. `S7` last. Merge each into `monolith/no-db` with a normal merge commit; file ownership in 3.1 keeps conflicts to `package.json` (S6 owns it; other sessions should not add dependencies, and must say so if they need one).

## 6. Prompt template for each session

> You are working in the `job-search` repo on branch `monolith/no-db`. Read `docs/planning/07-monolith-plan.md` sections 1-3 and then session **S\<N\>** only. Implement exactly that session's scope, code against the shared contracts, touch only the files that session owns, and do not add dependencies unless the session says so. Write the tests listed for the session, run `npm run typecheck`, `npm run lint` and `npm test` (and `npm test --prefix web` if you touched `web/`) and fix everything. Commit with a clear message, report what you verified and what you could not verify (for example anything needing network), and list any contract change you made to section 3 of the plan.

**Unanswered when S6 was done; defaults assumed, change if wrong:** (1) `main` is left as it is; (2) Render free tier, snapshot off (`render.yaml`), with cold-start crawls; (3) tens of sources.

## 8. Deploy runbook (Render)

Not yet tried; treat the first deploy as a test.

1. Push the branch. In Render choose **New > Blueprint**, select the repository and the branch `monolith/no-db` (reads `render.yaml`).
2. Set `CRAWLER_USER_AGENT` to something that identifies you, e.g. `YourBot/0.1 (+https://your.site; you@example.com)`.
3. Deploy. Build is `npm ci --include=dev && npm run build`, start is `npm start`, health check `/health`. Render sets `PORT`.
4. Check `/api/stats`: `crawl.ready`, then each source's state. Hosts that block shared hosting IPs show up as `failing` or `invalid`.

**Free-tier warning:** the instance sleeps when idle and wakes with an empty list, so the first visitor sees the "Still collecting" notice while everything is crawled again. Free instances have no persistent disk, so a snapshot does not survive. For real use take an always-on paid instance, and optionally attach a disk and set `SNAPSHOT_FILE` to a path on it.

**Adding sources:** locally run `npm run cli -- add <platform> <slug>` (or `discover`), commit `data/sources.json`, push; the redeploy picks it up. Editing the file on the server is lost on the next deploy.

**Memory:** watch `memory_mb` in `/api/stats` against the instance limit. Writing a snapshot and publishing after each crawl briefly need extra memory.

## 9. Verification record (S1-S7)

Run in a cloud sandbox with Node 22: lint, typecheck and tests for the backend; typecheck, lint, tests and build (including the bundle budget) for the web app; `npm start` booted, served `/health`, `/api/*` and the UI, and shut down on SIGTERM (all three seed crawls failed with "fetch failed" because the sandbox cannot reach them, which exercised the failure path only); Playwright 73 passed, 2 skipped by design, on a preinstalled Chromium older than the pinned one.

**Not run:** any live crawl or discovery, Docker, Render, GitHub Actions at the time of writing, memory use with real data, a visual review of the UI. Checklist: `03-verification-checklist.md` section 2.
