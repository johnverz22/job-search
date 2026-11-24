# job-search

Direct-to-company job aggregator pulling from ATS public endpoints (no LinkedIn/Indeed).

## Status
Phase 0-1 done; Phase 2 connectors (Recruitee, Personio, Teamtailor, Rippling, BambooHR) implemented with unit tests but **not yet verified live**. See the checklist.

## Docs
- [ATS source research](docs/planning/01-ats-sources.md)
- [Implementation plan](docs/planning/02-implementation-plan.md)
- [Verification checklist](docs/planning/03-verification-checklist.md)

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
```
Layout: `src/connectors/*` (one file per ATS), `src/worker.ts` (scheduler), `src/api.ts`, `src/store.ts`, `migrations/`.
