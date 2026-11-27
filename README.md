# job-search

Direct-to-company job aggregator pulling from ATS public endpoints (no LinkedIn/Indeed). **One Node process, no database:** it crawls the boards listed in `data/sources.json`, keeps every job in memory, and serves the API and web UI on one port.

A restart empties the list until the first crawl finishes (set `SNAPSHOT_FILE` to keep a copy on disk). The earlier Postgres version is on `main`, tagged `db-architecture`.

## Run
Needs Node 22 (20.19+ works).
```bash
npm ci
npm run build      # builds web/ (its own npm ci included), then the server
npm start          # http://localhost:8080
```
or `docker compose up --build`.

## Deploy on Vercel (snapshot mode)
Vercel has no long-running process, so the API cannot crawl there. Instead a scheduled GitHub Action (`.github/workflows/crawl.yml`) runs `npm run crawl` every 6 hours and commits `data/jobs.snapshot`; the push redeploys the site, and `api/[...all].js` serves the API read-only from that file. `ready` is always true and `/api/stats` shows the snapshot's sources.

1. Import the repo in Vercel. Framework preset **Other**, root directory = repo root (defaults come from `vercel.json`: build `npm run build`, output `web/dist`).
2. Push the branch — the first deploy works even before the first snapshot exists (empty job list until the Action runs).
3. Optionally run the Action once now: Actions → "job snapshot" → Run workflow.

To refresh more often, edit the cron in `crawl.yml`. To add a source, `npm run cli -- add ...`, commit, and the next scheduled crawl picks it up.

## Sources
```bash
npm run cli -- list
npm run cli -- probe gem superblocks          # live fetch, changes nothing
npm run cli -- add recruitee <slug>           # probes first, then writes data/sources.json
npm run cli -- remove recruitee <slug>
npm run discover -- urls urls.txt --dry       # slug discovery; see the runbook
```
The server reads the file at startup: commit the change and restart or redeploy.

## Develop
```bash
npm ci && npm run web:install
npm run dev                          # API on :8080 (restarts on change) + Vite dev server proxying /api
npm run lint && npm run typecheck && npm test
npm run web:test                     # UI unit + component tests (jsdom)
npm run build && (cd web && npx playwright install chromium && npx playwright test)   # browser tests, no network needed
```
Layout: `src/connectors/*` (one file per ATS), `src/aggregator.ts` (crawl loop), `src/snapshot.ts`, `src/search.ts` + `src/query.ts`, `src/app.ts` (HTTP), `src/server.ts` (entrypoint), `web/`.

Configuration is by environment variable; every one is listed in `.env.example`.

## Docs
- [Monolith plan, behaviour, status and deploy runbook](docs/planning/07-monolith-plan.md)
- [API and search](docs/planning/05-api.md) (machine-readable: `GET /api/openapi.json`)
- [Slug discovery runbook](docs/planning/04-discovery-runbook.md)
- [Verification checklist](docs/planning/03-verification-checklist.md)
- [ATS source research](docs/planning/01-ats-sources.md)
- [Web UI plan](docs/planning/06-ui-plan.md)
- [Original implementation plan](docs/planning/02-implementation-plan.md) (Postgres architecture; partly superseded)

## Connector status
Recruitee, Personio, Teamtailor, Rippling, BambooHR, Gem, Pinpoint, JazzHR, Jobvite, iCIMS, Taleo (Business Edition), Workday, Y Combinator are unit-tested. Gem, Pinpoint and Personio response shapes were confirmed against live endpoints (Recruitee probed OK); the rest need live verification, see the checklist. Dover is deferred.
