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
- [x] Personio: VERIFIED live 2026-11-26 (`aiya-europe.jobs.personio.de`): titles, offices, departments, employment types, dates and apply URLs all populate; `jobDescription` sections render to HTML. Caveat: some postings return `descriptionHtml: null` — either they genuinely have no description sections or use section names the normalizer doesn't cover; spot-check if descriptions look sparse
- [~] Recruitee: probed live OK 2026-11-26 (`11bitstudios`, 9 jobs; titles/locations/remote/employmentType/postedAt/applyUrl all populated), but `salary` shape and `experience_code` still unconfirmed — sampled jobs had no salary data
- [x] Pinpoint: VERIFIED live 2026-11-26. `postings.json` returns `{"data":[...]}` with flat fields; `location`, `job.department`, `workplace_type_text`, `employment_type_text`, `compensation_{visible,currency,minimum,maximum}` all map correctly (salary fields added to the normalizer). There is NO posted-date field (`deadline_at` is an application deadline), so `postedAt` stays null. `compensation` free-text is absent on real boards; min/max/currency carry the data
- [ ] JazzHR / Jobvite: do the listing links match `linkPattern` in `src/connectors/htmlJsonLd.ts`? Does each job page include JSON-LD? (Jobvite listing may be partly JS-rendered)
- [ ] iCIMS: does `/jobs/search?ss=1&pr=N&in_iframe=1` paginate with `pr` (0-based)? Do job links match `/jobs/{id}/...`, and do job pages (with `?in_iframe=1`) carry JSON-LD? Many portals are not `careers-*`
- [ ] Taleo (TBE): the paging parameter (code guesses `pageNum`; if wrong, only page 1 is ingested); `viewRequisition?...rid=` link shape; JSON-LD on job pages. Classic `careersection` boards are out of scope
- [ ] Workday: `total` only on the first page? `bulletFields[0]` really the requisition id? Facet structure (`facets[].values[].facetParameter/id/count`) and whether `appliedFacets` accepts the ids as written; `startDate`/`remoteType`/`additionalLocations` names in the detail; behaviour at the 2,000 cap on a large tenant (e.g. a university or bank with >2,000 postings)
- [ ] YC: does `/companies/{slug}/jobs` link to job pages with JSON-LD, and does robots.txt/terms allow crawling it? If not, drop the connector
- [ ] Custom domains: run `discover domains` on a seed list with a few known Recruitee/Personio/Rippling customers that use their own domain, and confirm `/api/offers/` / `/xml` really answer there
- [ ] Dover: find the real public board endpoint (browser network tab on an `app.dover.com/jobs/{company}` page) before writing a connector

## 2. Local end-to-end (monolith)
```bash
npm ci && npm run build && npm start
curl localhost:8080/health
curl localhost:8080/api/stats      # crawl.ready, per-source state
curl "localhost:8080/api/jobs?limit=5"
```
- [ ] the three seed sources reach state `ok` with plausible job counts
- [ ] UI at http://localhost:8080 shows the "Still collecting" notice, then results
- [ ] search a few real queries and judge the ranking
- [ ] with `SNAPSHOT_FILE=data/jobs.ndjson.gz`: stop with Ctrl-C, start again, jobs appear immediately
- [ ] `memory_mb` is acceptable for your source count
- [ ] `npm run cli -- add <platform> <slug>` then `npm run discover -- cc gem --pages 1 --dry` work against the real internet
- [ ] `docker compose up --build` (never built: no Docker where this was written)
- [ ] Render deploy (see [07](07-monolith-plan.md) section 8)
- [ ] GitHub Actions run is green on this branch

## 3. Open items / next
- [x] CI: typecheck, lint, backend tests, web tests and build, Playwright (`.github/workflows/ci.yml`)
- [x] Per-job detail cache (now held in memory; lost on restart unless a snapshot is used)
- Live verification of the connectors above, the Recruitee token fallback before 2027-02-10, Dover
