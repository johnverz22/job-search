# Verification checklist (do before trusting the connectors)

The connectors were written from documented field names and have **never been run against live endpoints**. Rippling and Teamtailor `remoteStatus` are the least certain.

## 1. Probe each connector live (no DB needed)
```bash
npm install
npm run cli -- probe recruitee <slug>
npm run cli -- probe personio <slug>
npm run cli -- probe teamtailor <careers-host>   # e.g. acme.teamtailor.com or a custom careers domain
npm run cli -- probe rippling <slug>
npm run cli -- probe bamboohr <subdomain>
npm run cli -- probe gem <board>          # e.g. superblocks; verified shape, quick sanity check
npm run cli -- probe pinpoint <subdomain> # e.g. workwithus
npm run cli -- probe jazzhr <subdomain>   # {subdomain}.applytojob.com
npm run cli -- probe jobvite <company>    # jobs.jobvite.com/{company}
npm run cli -- probe icims <portal>       # careers-acme -> careers-acme.icims.com
npm run cli -- probe workday <tenant>.<wdN>/<site>   # e.g. nvidia.wd5/NVIDIAExternalCareerSite
npm run cli -- probe taleo <sub>/<pod>/<org>/<cws>   # from a tbe.taleo.net searchResults URL
npm run cli -- probe yc <company>         # ycombinator.com/companies/{company}/jobs
```
For each: confirm job count looks right, title/location/description/apply URL are populated, `postedAt` parses.

If a field is empty or wrong: save the raw response as `tests/fixtures/<platform>.json|xml`, fix the normalizer, and turn the fixture into a test.

Known unknowns:
- [ ] Rippling: envelope shape (`items`/`jobs`/array), pagination fields, location and workplace-type fields
- [ ] Teamtailor: `remoteStatus` values; whether `tt:` namespace prefixes match real feeds
- [ ] BambooHR: `locationType` / `isRemote` semantics; detail response shape
- [ ] Recruitee: `experience_code`, `salary` shape; behaviour on custom domains
- [ ] Personio: description section names and `.com` vs `.de` hosts
- [ ] Pinpoint: `postings.json` envelope and field names (`location`, `department`, `compensation`, dates); alternative is the verified-to-exist `https://{sub}.pinpointhq.com/jobs.rss`
- [ ] JazzHR / Jobvite: do the listing links match `linkPattern` in `src/connectors/htmlJsonLd.ts`? Does each job page include JSON-LD? (Jobvite listing may be partly JS-rendered)
- [ ] iCIMS: does `/jobs/search?ss=1&pr=N&in_iframe=1` paginate with `pr` (0-based)? Do job links match `/jobs/{id}/...`, and do job pages (with `?in_iframe=1`) carry JSON-LD? Many portals are not `careers-*`
- [ ] Taleo (TBE): the paging parameter (code guesses `pageNum`; if wrong, only page 1 is ingested); `viewRequisition?...rid=` link shape; JSON-LD on job pages. Classic `careersection` boards are out of scope
- [ ] Workday: `total` only on the first page? `bulletFields[0]` really the requisition id? Facet structure (`facets[].values[].facetParameter/id/count`) and whether `appliedFacets` accepts the ids as written; `startDate`/`remoteType`/`additionalLocations` names in the detail; behaviour at the 2,000 cap on a large tenant (e.g. a university or bank with >2,000 postings)
- [ ] YC: does `/companies/{slug}/jobs` link to job pages with JSON-LD, and does robots.txt/terms allow crawling it? If not, drop the connector
- [ ] Custom domains: run `discover domains` on a seed list with a few known Recruitee/Personio/Rippling customers that use their own domain, and confirm `/api/offers/` / `/xml` really answer there
- [ ] Dover: find the real public board endpoint (browser network tab on an `app.dover.com/jobs/{company}` page) before writing a connector

## 2. Docker end-to-end
```bash
cp .env.example .env
docker compose up --build -d
docker compose run --rm cli node dist/cli.js add recruitee <slug>
docker compose logs -f worker
curl "localhost:8080/jobs?limit=5"
curl "localhost:8080/health"
```
- [ ] migrate exits 0, worker and api start
- [ ] jobs appear in `/jobs` after one worker pass
- [ ] removing a job upstream closes it on the next pass (status = closed)

## 2b. Worker/DB integration test (already passing in my sandbox)
```bash
DATABASE_URL=postgres://jobsearch:jobsearch@localhost:5432/jobsearch npm run test:integration
```
Needs `psql` and a throwaway database (it TRUNCATEs `jobs` and `sources`!). Stubs `fetch`, so it needs no network.

## 3. Open items / next
- [x] CI (typecheck, unit + DB-backed tests, worker integration) in `.github/workflows/ci.yml`
- [x] Lint step (ESLint + typescript-eslint, `npm run lint`, runs in CI after typecheck)
- [x] Per-job detail cache for BambooHR/JazzHR/Jobvite (see Phase 6 in the implementation plan); the integration test counts detail requests
- Redis is provisioned but unused (the worker uses Postgres leases instead; consider removing Redis from compose unless a queue/shared rate limit is needed) (reserved for queue/rate-limit/cache); in-memory per-host throttle only for now
- Still open: live verification of everything above, a live discovery run (blocked in the sandbox that built Phase 4: no DNS for crt.sh/Common Crawl/ATS hosts), the Recruitee token fallback before 2027-02-10, Dover
