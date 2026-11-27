# API and search

Read-only JSON API (`src/app.ts`, started by `src/server.ts`) over the jobs held in memory. The machine-readable contract is `GET /api/openapi.json`; its parameter list is rendered from the table the parser uses (`JOB_PARAMS` in `src/query.ts`). This page covers behaviour a parameter list can't. (The Postgres version of this page is on `main`.)

## Endpoints
| Endpoint | Purpose |
|---|---|
| `GET /api/jobs` | Search and list jobs (cursor-paginated) |
| `GET /api/jobs/:id` | One job with `description_html`. `id` is 12 hex characters; `status` is always `open` |
| `GET /api/facets` | Top 50 values per filter with job counts. Cacheable 5 minutes once the first crawl is done, `no-store` before |
| `GET /api/stats` | Jobs per platform, source states (`ok`, `pending`, `failing`, `invalid`), crawl progress, memory |
| `GET /health` (also `/api/health`) | The process is up. Does not wait for the crawl |
| `GET /api/openapi.json` | OpenAPI 3 spec |

Errors are JSON: `400 invalid_query` (unknown or invalid parameters are rejected, not ignored), `400 invalid_id`, `404 not_found`.

## Search
- Words in `q` are AND-ed and match the **start of a word** in the title, department, company or description (`java` also finds `javascript`). One and two letter words (`go`, `qa`, and `c` from `c++`) must be whole words.
- Light suffix stripping (`s`, `es`, `ing`, `ed`): `developing` finds `developer`. This is not real stemming.
- `"quoted phrase"` is a case-insensitive substring, `-term` excludes, `a or b` separates alternatives (`a b or c` means `(a b) or c`). Stop words are ignored; a query of only stop words returns nothing.
- Only visible text is searched (tags stripped, entities decoded), at most 20,000 characters per description.
- Relevance: for each term, `4 x title + 2 x department + 2 x company + 1 x description` hits (description capped at 5), plus 3 for a phrase found in the title. `relevance` appears only when sorting by relevance.
- `sort` is `relevance` (default with `q`) or `newest` (default without). Newest uses `posted_at`, else `first_seen`.
- Results are not identical to the Postgres version on `main`.

## Pagination
Follow `next_cursor` until it is `null`. A cursor is bound to the filters and sort that produced it (400 otherwise). It marks a position in the ordering, so it keeps working while sources refresh; after a **restart**, undated jobs get a new `first_seen` (unless a snapshot is used), so a held cursor may skip or repeat some. `offset` is deprecated and capped at 10,000.

## Filter semantics worth knowing
- `remote=false` means *known* on-site/hybrid; unknown matches neither value.
- `min_salary` / `max_salary` match the **range** (top at least the minimum, bottom at most the maximum), require `salary_currency`, and never match jobs without a structured salary. Amounts are as advertised (hourly/monthly/yearly are not normalized).
- `employment_type` and `seniority` are the platform's own labels, case-insensitive exact match.
- `department` and `location` are case-insensitive substrings, taken literally.
- `distinct=true` keeps one posting per `(company, title, locations)` group: the one that sorts first.

## Performance (measured, synthetic data)
50,000 jobs with about 4 kB of description each, 2-core cloud sandbox, warm: newest and filtered pages under 1 ms; a text query 70-220 ms (every description is scanned, on the same thread that serves requests). That is above the plan's 100 ms target at that size and grows linearly, so around 20,000 jobs it is back under it. The first request after each crawl also re-sorts the list. If it matters, the next step is a per-job word-prefix index. Re-measure on real data.
