# Slug discovery runbook

Discovery finds company slugs per ATS; validation proves a slug is a real board before the worker crawls it.
Flow: `discover ...` -> rows in `sources` (disabled, `validation_status='unvalidated'`) -> `discover validate` -> `enabled=true, validation_status='valid'` -> worker picks them up.

Run via Docker (inside the compose network) or locally (`npm run discover -- ...`, needs `DATABASE_URL`):
```bash
docker compose run --rm cli node dist/discover.js <command>
```

## Commands
| Command | Use |
|---|---|
| `crtsh <platform> [--dry]` | Hostnames from Certificate Transparency. Subdomain platforms only: recruitee, personio, bamboohr, pinpoint, jazzhr, teamtailor, icims. Not for workday, taleo or yc (the slug needs the site / org / path, which certificates do not contain) |
| `cc <platform> [--pages N] [--crawl CC-MAIN-YYYY-WW] [--dry]` | Common Crawl index. Works for path platforms too (gem, jobvite, rippling, workday, taleo, yc). Start with `--pages 2` and `--dry` |
| `urls <file\|-> [--dry]` | Extract slugs from a list of URLs, e.g. Google results from the operators in `01-ats-sources.md` |
| `page <url> [--dry]` | Detect ATS boards on a company careers page (links, embeds, Teamtailor custom domain) |
| `domains <file\|->` | Seed list of company domains or careers-page URLs (one per line, `#` comments). Scans `/`, `careers.`, `jobs.` and `/careers` pages for ATS links/embeds and probes each reachable host for a custom-domain Recruitee (`/api/offers/`) or Personio (`/xml`) feed. Candidate slug = the full host. Always `--dry` first |
| `validate [--limit N]` | Probe unvalidated candidates with the real connector |

## Suggested first run
```bash
discover cc gem --pages 2 --dry            # sanity check the output
discover cc gem --pages 5
discover crtsh recruitee --dry
discover crtsh recruitee
discover validate --limit 200              # repeat until nothing is left unvalidated
```
Check progress:
```sql
SELECT platform, validation_status, count(*) FROM sources GROUP BY 1,2 ORDER BY 1,2;
```

## Not yet run live
Everything above is unit-tested but has never been run against crt.sh, Common Crawl or real careers sites (the environment it was built in had no DNS for them). Do these first, in order, and tune from the output:
```bash
discover cc gem --pages 2 --dry
discover crtsh icims --dry
discover cc workday --pages 2 --dry         # check the tenant.wdN/site slugs look right
discover domains seeds.txt --dry            # 10-20 company domains you know use Recruitee/Personio/Rippling
```
Then probe a handful of the slugs with `npm run cli -- probe <platform> <slug>` (see the verification checklist) before running `validate` in bulk.

## Notes and risks
- iCIMS subdomains are not all career portals; some validate as boards with 0 jobs. Check `SELECT ... WHERE platform='icims' AND jobs_found = 0` and prune.
- Workday slugs need the *site* name. If you only have tenant hosts (e.g. from certificates), fetch `https://{tenant}.{wdN}.myworkdayjobs.com/` in a browser to find the site, or use a company careers page with `discover page <url>`.
- Run `probe` on a few known slugs for each platform (see verification checklist) BEFORE bulk validation, otherwise a wrong parser marks real boards invalid only after 3 attempts or a 4xx. If you change a parser, reset: `UPDATE sources SET validation_status='unvalidated', validation_attempts=0 WHERE validation_status='invalid' AND platform='<p>';`
- crt.sh is a free community service. Large domains (e.g. bamboohr.com) often time out or return 502; retry later or lean on Common Crawl. Do not hammer it.
- Common Crawl index responses are large. The fetcher is rate-limited (1.5s/host) and capped by `--pages`.
- Common Crawl shows pages that existed at crawl time, so some slugs will be dead; validation filters them.
- Reserved subdomains (`www`, `api`, `app`, ...) are filtered in `src/discovery/patterns.ts`. Add to `RESERVED` when you see junk slugs.
- BambooHR: invalid subdomains can redirect instead of 404; the connector requires a JSON `result` array, so these fail validation.
- Respect each site's terms and robots.txt; keep request rates low and keep the descriptive `CRAWLER_USER_AGENT` set.
