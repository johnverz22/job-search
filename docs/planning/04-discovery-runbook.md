# Slug discovery runbook

Discovery finds company slugs per ATS and adds the working ones to `data/sources.json` (see [07](07-monolith-plan.md)).
Flow: `discover ...` -> each new candidate is probed with its connector -> boards that answer are merged into the file (sorted, no duplicates) -> review the diff, commit, redeploy.

```bash
npm run discover -- <command>          # from source
node dist/discover.js <command>        # after a build
```
`SOURCES_FILE` chooses a different file.

## Commands
| Command | Use |
|---|---|
| `crtsh <platform>` | Hostnames from Certificate Transparency. Subdomain platforms only: recruitee, personio, bamboohr, pinpoint, jazzhr, teamtailor, icims. Not for workday, taleo or yc (the slug needs the site / org / path) |
| `cc <platform> [--pages N] [--crawl CC-MAIN-YYYY-WW]` | Common Crawl index. Works for path platforms too (gem, jobvite, rippling, workday, taleo, yc). Start with `--pages 2 --dry` |
| `urls <file\|->` | Extract slugs from a list of URLs, e.g. search results from the operators in `01-ats-sources.md` |
| `page <url>` | Detect ATS boards on a company careers page (links, embeds, Teamtailor custom domain) |
| `domains <file\|->` | Company domains or careers URLs, one per line (`#` comments), e.g. `seeds.txt`. Scans their careers pages and probes for custom-domain Recruitee/Personio feeds |

Options: `--dry` lists new candidates without probing or writing; `--limit N` probes at most N new candidates (default 100).

Probe results: `valid` is added (a board with 0 jobs is added but flagged), `invalid` (400/401/403/404/410) and `transient` (anything else) are only reported; rerun to retry them.

**Every listed source costs memory and crawl time**, so add deliberately: tens are fine, hundreds need an always-on instance.

## Suggested first run
```bash
npm run discover -- cc gem --pages 2 --dry     # sanity check the output
npm run discover -- cc gem --pages 2 --limit 20
npm run cli -- list
```

## Live status
`main` recorded a live Common Crawl run for pinpoint and recruitee, before this rewrite. The rewritten commands are tested with fake connectors only and have **not** been run live. Always `--dry` first, and `probe` a few known slugs per platform (see the verification checklist) before adding in bulk.

## Notes and risks
- iCIMS subdomains are not all career portals; some validate as boards with 0 jobs. These are flagged in the output; remove them with `npm run cli -- remove icims <portal>`.
- Workday slugs need the *site* name. If you only have tenant hosts (e.g. from certificates), fetch `https://{tenant}.{wdN}.myworkdayjobs.com/` in a browser to find the site, or use a company careers page with `discover page <url>`.
- A wrong parser can report a real board as `invalid` or add an empty one; after fixing a parser, rerun discovery.
- crt.sh is a free community service. Large domains (e.g. bamboohr.com) often time out or return 502; retry later or lean on Common Crawl. Do not hammer it.
- Common Crawl index responses are large. The fetcher is rate-limited (1.5s/host) and capped by `--pages`.
- Common Crawl shows pages that existed at crawl time, so some slugs will be dead; probing filters them.
- Reserved subdomains (`www`, `api`, `app`, ...) are filtered in `src/discovery/patterns.ts`. Add to `RESERVED` when you see junk slugs.
- BambooHR: invalid subdomains can redirect instead of 404; the connector requires a JSON `result` array, so these fail validation.
- Respect each site's terms and robots.txt; keep request rates low and keep the descriptive `CRAWLER_USER_AGENT` set.
