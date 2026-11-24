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
| `crtsh <platform> [--dry]` | Hostnames from Certificate Transparency. Subdomain platforms only: recruitee, personio, bamboohr, pinpoint, jazzhr, teamtailor |
| `cc <platform> [--pages N] [--crawl CC-MAIN-YYYY-WW] [--dry]` | Common Crawl index. Works for path platforms too (gem, jobvite, rippling). Start with `--pages 2` and `--dry` |
| `urls <file\|-> [--dry]` | Extract slugs from a list of URLs, e.g. Google results from the operators in `01-ats-sources.md` |
| `page <url> [--dry]` | Detect ATS boards on a company careers page (links, embeds, Teamtailor custom domain) |
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

## Notes and risks
- Run `probe` on a few known slugs for each platform (see verification checklist) BEFORE bulk validation, otherwise a wrong parser marks real boards invalid only after 3 attempts or a 4xx. If you change a parser, reset: `UPDATE sources SET validation_status='unvalidated', validation_attempts=0 WHERE validation_status='invalid' AND platform='<p>';`
- crt.sh is a free community service. Large domains (e.g. bamboohr.com) often time out or return 502; retry later or lean on Common Crawl. Do not hammer it.
- Common Crawl index responses are large. The fetcher is rate-limited (1.5s/host) and capped by `--pages`.
- Common Crawl shows pages that existed at crawl time, so some slugs will be dead; validation filters them.
- Reserved subdomains (`www`, `api`, `app`, ...) are filtered in `src/discovery/patterns.ts`. Add to `RESERVED` when you see junk slugs.
- BambooHR: invalid subdomains can redirect instead of 404; the connector requires a JSON `result` array, so these fail validation.
- Respect each site's terms and robots.txt; keep request rates low and keep the descriptive `CRAWLER_USER_AGENT` set.
