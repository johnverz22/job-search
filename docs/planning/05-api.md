# API and search

Read-only JSON API (`src/app.ts`, started by `src/api.ts`). The machine-readable contract is `GET /openapi.json`; it is rendered from the same parameter table the parser uses (`JOB_PARAMS` in `src/query.ts`), and a unit test fails if the two drift apart. This page covers behaviour that a parameter list can't.

## Endpoints
| Endpoint | Purpose |
|---|---|
| `GET /jobs` | Search and list **open** jobs (cursor-paginated) |
| `GET /jobs/:id` | One job with `description_html`; closed jobs are returned too (check `status`) |
| `GET /facets` | Top filter values with open-job counts (platform, employment_type, seniority, department, location, salary_currency); cached 5 minutes |
| `GET /stats`, `GET /health` | Operational |

**Paths are served under `/api`** by the real server (`/api/jobs`, `/api/jobs/:id`, `/api/facets`, `/api/stats`, `/api/openapi.json`); this table and the rest of the page use the short form. `/health` is also available at the root. The unprefixed paths now belong to the web UI (`/jobs/:id` is a page, not JSON). The test suite mounts the API without the prefix (`buildApp`), the server with it (`buildServer`).
| `GET /openapi.json` | OpenAPI 3 spec |

Errors are JSON: `400 {"error":"invalid_query","message":"..."}` (unknown or invalid parameters are rejected, not ignored), `404 {"error":"not_found"}`.

## Search
- `q` uses Postgres `websearch_to_tsquery('english', ...)`: words are AND-ed and stemmed (`developing` finds `developer`), `"quoted phrase"`, `-excluded`, `a or b`. Malformed input never errors; a query of only stop words (e.g. `the`) returns an empty page.
- Indexed text (generated column `search_tsv`, migration `004_search.sql`): title (weight A) > department and company slug (B) > description with HTML tags/entities stripped (C). Only the first 100,000 characters of a description are indexed, so a huge posting can't make the crawler's INSERT fail.
- Relevance is `ts_rank_cd` with length normalization, so a short exact-title match beats a long description. Scores are comparable only within one query.
- `sort` is `relevance` (default with `q`) or `newest` (default without). Newest orders by `posted_at`, falling back to `first_seen` for postings without a date, so undated jobs interleave by when we first saw them instead of sinking to the end.

## Pagination
Follow `next_cursor` until it is `null`. Cursors are keyset based: no skipped or repeated rows when jobs are added between requests, and cost doesn't grow with depth. A cursor is bound to the filters and sort that produced it and is rejected (400) if reused with different ones. `offset` still works but is deprecated and capped at 10,000.

## Filter semantics worth knowing
- `remote=false` means *known* on-site/hybrid; jobs with unknown remote status match neither `true` nor `false`.
- `min_salary` / `max_salary` match the **range**: a job matches `min_salary=X` if the top of its range is at least X, and `max_salary=Y` if the bottom is at most Y. They require `salary_currency` (amounts in different currencies aren't comparable), and jobs with no structured salary never match. Amounts are the raw advertised numbers; connectors don't normalize hourly/monthly/yearly.
- `employment_type` and `seniority` are the platform's own labels (not normalized), matched case-insensitively and exactly.
- `department` and `location` are case-insensitive substring matches; `%` and `_` in the input are matched literally.
- `distinct=true` keeps one posting per `(company, title, locations)` group (the best-ranked, or newest). Legacy rows without a `dedupe_key` are never merged.

## Performance (measured, synthetic data)
200k rows, 254 MB with indexes, local Postgres 16, real generated SQL under `EXPLAIN ANALYZE`:

| Query | Time |
|---|---|
| newest, first page / page 200 via cursor | ~0.13 ms / ~0.12 ms (`offset=10000` for comparison: ~7 ms and growing) |
| `q` with a rare term (GIN) | ~2 ms |
| `q` matching ~12% of rows, relevance sort | ~100-140 ms (every match is scored) |
| `distinct=true` | ~300-400 ms (sorts the open set) |

Synthetic, uniformly distributed text: real distributions will differ. Re-measure after the first large live crawl.

## Migration note
`004_search.sql` adds two stored generated columns, which rewrites `jobs` once. Fine at this size; on a much larger table run it in a quiet window.

## Testing
- `npm test` runs the unit tests (query building, cursor encode/decode, SQL placeholder consistency, OpenAPI/parser agreement).
- The DB-backed tests (`tests/api.db.test.ts`, `app.inject` against real Postgres) only run when `TEST_DATABASE_URL` is set. They `TRUNCATE jobs, sources`, so they never read `DATABASE_URL`, and they refuse to run unless the database name contains `test`.
  ```bash
  TEST_DATABASE_URL=postgres://jobsearch:jobsearch@localhost:5432/jobsearch_test npm test
  ```
- Covered against real Postgres: ranking, stemming, phrase/exclusion/or, HTML not indexed, hostile `q`, 1.4 MB descriptions, every filter, `%`/`_` literal matching, distinct (incl. null `dedupe_key`), full cursor walks (ties on identical timestamps, microsecond-apart timestamps, equal relevance, distinct) checked against an independent SQL ordering, cursor misuse, `/jobs/:id`, and index eligibility.
