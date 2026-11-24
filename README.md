# job-search

Direct-to-company job aggregator pulling from ATS public endpoints (no LinkedIn/Indeed).

## Status
Phases 0-2 done, Phases 3-5 partly done (slug discovery is built; run it live per the runbook). Connectors: Recruitee, Personio, Teamtailor, Rippling, BambooHR, Gem, Pinpoint, JazzHR, Jobvite (all unit-tested). Only Gem's response shape is confirmed against real samples; the rest need live verification, see the checklist. Dover is deferred.

## Docs
- [ATS source research](docs/planning/01-ats-sources.md)
- [Implementation plan](docs/planning/02-implementation-plan.md)
- [Verification checklist](docs/planning/03-verification-checklist.md)
- [Slug discovery runbook](docs/planning/04-discovery-runbook.md)

## Run with Docker Compose
```bash
cp .env.example .env
docker compose up --build -d
docker compose run --rm cli node dist/cli.js add recruitee <slug>
curl "localhost:8080/jobs?limit=5"
```

## Local dev
```bash
npm install
npm test
npm run cli -- probe recruitee <slug>   # live fetch, no DB
npm run discover -- urls urls.txt --dry # slug discovery; see runbook
```
Layout: `src/connectors/*` (one file per ATS), `src/worker.ts` (scheduler), `src/api.ts`, `src/store.ts`, `migrations/`.
