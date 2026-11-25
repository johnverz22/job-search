# Additional ATS Sources (research, as of 2026-11-25)

Existing connectors: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, BreezyHR.
This file lists 18 additional sources. Undocumented endpoints can change; verify each with a live request before building.

## Top 5 easiest (clean data, plain HTTP, no headless browser)

| Rank | Platform | Endpoint | Format | Auth |
|---|---|---|---|---|
| 1 | Recruitee | `GET https://{slug}.recruitee.com/api/offers/` | JSON | None today (see caveat) |
| 2 | Personio | `GET https://{slug}.jobs.personio.de/xml?language=en` (also try `.com`) | XML | None |
| 3 | Teamtailor | `GET https://{careers-domain}/jobs.rss` (JSON Feed variant reported: `https://{slug}.teamtailor.com/jobs.json`) | RSS/XML | None |
| 4 | Rippling | `GET https://api.rippling.com/platform/api/ats/v2/board/{slug}/jobs?page=0&pageSize=1000` | JSON | None |
| 5 | BambooHR | `GET https://{company}.bamboohr.com/careers/list`, then `/careers/{id}/detail` | JSON | None |

**Recruitee caveat:** public unauthenticated access is documented to stop on **2027-02-10**; afterwards an `X-Careers-Sites-Token` (created in each customer's account) is expected. Keep a fallback that preserves job URLs and can ingest HTML/JSON-LD.

## Full list

### 6. Pinpoint
- Market: UK/US mid-market
- Access: `GET https://{company}.pinpointhq.com/postings.json` (public JSON, no key, may include compensation)
- Discovery: `site:pinpointhq.com "postings.json"`, `inurl:pinpointhq.com/postings.json`, `site:*.pinpointhq.com`; crawl career pages for `pinpointhq.com` links
- Difficulty: Easy (plain JSON)

### 7. JazzHR
- Market: small/mid-market US
- Access: HTML board `https://{company}.applytojob.com/apply`; no public JSON/XML. Official API needs employer's key (not usable for aggregation)
- Discovery: `site:applytojob.com/apply`, `inurl:applytojob.com/apply`, `site:*.applytojob.com`
- Difficulty: Moderate (HTML list + per-job schema.org `JobPosting` JSON-LD)

### 8. Workday
- Market: large enterprise, universities, healthcare, government
- Access: `POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` body `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}` (unauthenticated, but browser-facing, not a formal public API)
- Discovery: `site:myworkdayjobs.com`, `site:*.wd1.myworkdayjobs.com`, `site:*.wd5.myworkdayjobs.com`; better: crawl `/careers` pages for `myworkdayjobs.com` links and extract tenant, `wdN`, site
- Difficulty: Moderate-high (20 per page, totals can cap at 2,000, second GET per job for details)

### 9. iCIMS
- Market: enterprise
- Access: `GET https://careers-{company}.icims.com/jobs/search?ss=1&pr=0&in_iframe=1` (HTML, paginate with `pr`); JSON-LD `JobPosting` on job pages
- Discovery: `site:icims.com/jobs/search`, `site:careers-*.icims.com`, `inurl:careers-*.icims.com/jobs/search`
- Difficulty: Moderate-high (HTML parsing, varied configs, polite rate limits)

### 10. Oracle Taleo
- Market: large enterprise, legacy HR
- Access: `GET https://{sub}.tbe.taleo.net/{pod}/ats/careers/v2/searchResults?org={org}&cws={cws}` (HTML, 25/page); job pages often expose JSON-LD
- Discovery: `site:tbe.taleo.net`, `inurl:tbe.taleo.net`, `site:*.tbe.taleo.net`; extract `org` and `cws` from indexed URLs
- Difficulty: High (URL structure varies, inconsistent HTML)

### 11. Jobvite
- Market: mid-market and enterprise
- Access: `https://jobs.jobvite.com/{company}/jobs` (server-rendered HTML); each `/job/{id}` page commonly has JSON-LD. Vendor XML/JSON feed is customer-specific and often disabled
- Discovery: `site:jobs.jobvite.com`, `inurl:jobs.jobvite.com`, `site:jobs.jobvite.com/*/jobs`
- Difficulty: Moderate

### 12. Dover
- Market: startups, growth-stage
- Access: boards at `https://app.dover.com/{Company}/careers/{board-uuid}`; list endpoint `https://app.dover.com/api/v1/careers-page/{board-uuid}/jobs?limit=300&offset=...` (zero-auth)
- Discovery: `site:app.dover.com/*/careers`, `inurl:app.dover.com/careers`; crawl startup career pages for Dover embeds
- Difficulty: Easy-moderate (must resolve board UUID from the careers page)

### 13. Gem
- Market: startups, mid-market tech
- Access: public job-board feed reported, route is customer-specific; discover from network requests or embedded data
- Discovery: `site:gem.com "jobs" "careers"`, `site:jobs.gem.com`; crawl career pages for `gem.com` assets/API calls
- Difficulty: Moderate (verify the endpoint live first)

### 14. Personio (jobs domains)
- Market: Europe, especially DACH; also Spain, Netherlands
- Access: `https://{slug}.jobs.personio.de/xml?language=en` or `.jobs.personio.com`; no credentials
- Discovery: `site:jobs.personio.de/xml`, `site:*.jobs.personio.de`, `site:*.jobs.personio.com`, `inurl:jobs.personio.de/xml`
- Difficulty: Easy (XML)

### 15. Teamtailor (custom domains)
- Market: Europe/Nordics startups, scale-ups, mid-market
- Access: `https://{careers-domain}/jobs.rss` works on custom domains; escaped HTML descriptions, location, department, role, remote status
- Discovery: `site:teamtailor.com/jobs.rss`, `inurl:teamtailor.com/jobs.rss`, `"jobs.rss" "teamtailor"`; for custom domains detect `teamtailor-cdn` / `assets.teamtailor` in HTML
- Difficulty: Easy (RSS)

### 16. Recruitee (custom domains)
- Market: European startups/mid-market, strong NL/EU
- Access: `https://{slug}.recruitee.com/api/offers/` (description, requirements, locations, remote flags, salary, timestamps)
- Discovery: `site:recruitee.com/api/offers`, `site:*.recruitee.com`, `inurl:recruitee.com/api/offers`; custom domains: detect Recruitee assets/links in careers HTML
- Difficulty: Easy today; plan for the Feb 2027 auth change

### 17. BambooHR (custom subdomains)
- Market: SMB/mid-market, US
- Access: `https://{company}.bamboohr.com/careers/list` (JSON), `/careers/{id}/detail` (description, posting date, compensation text). Undocumented but used by BambooHR's own pages
- Discovery: `site:bamboohr.com/careers/list`, `site:*.bamboohr.com/careers`, `inurl:bamboohr.com/careers/list`
- Difficulty: Easy for list, moderate for full descriptions (one request per job). Invalid subdomains can redirect instead of 404; validate carefully

### 18. Y Combinator / Work at a Startup
- Market: YC-backed startups
- Access: `https://www.ycombinator.com/companies/{company}/jobs`, `https://www.workatastartup.com/jobs/{id}` (server-rendered; no official bulk API; third-party APIs are paid wrappers)
- Discovery: `site:ycombinator.com/companies/*/jobs`, `site:workatastartup.com/jobs`
- Difficulty: Moderate-high (respectful crawling, parse HTML/JSON-LD)

## Implemented connectors and their slug formats
The `sources.company_slug` value each connector expects (all connectors; `cli add <platform> <slug>`):

| Platform | Slug | Example |
|---|---|---|
| recruitee, bamboohr, pinpoint, jazzhr, jobvite, rippling, gem | company identifier | `acme` |
| personio, recruitee | subdomain, or the full careers host for a custom domain (contains a dot) | `acme-gmbh`, `careers.acme.com` |
| teamtailor | careers host | `acme.teamtailor.com` |
| icims | portal subdomain | `careers-acme` |
| workday | `{tenant}.{wdN}/{site}` | `nvidia.wd5/NVIDIAExternalCareerSite` |
| taleo (TBE) | `{sub}/{pod}/{org}/{cws}` | `phf/phf01/ACME/37` |
| yc | YC company slug | `airbnb` |

Not implemented: Dover (no confirmed keyless endpoint), classic Taleo (`*.taleo.net/careersection`).

## Cross-cutting slug discovery (beyond Google)
- Common Crawl index queries for each host pattern (e.g. `*.recruitee.com`, `*.jobs.personio.de`, `*.bamboohr.com/careers`)
- Certificate Transparency (crt.sh) for `%.recruitee.com`, `%.pinpointhq.com`, `%.applytojob.com`, `%.bamboohr.com`
- Crawl company career pages and match ATS signatures: `boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`, `apply.workable.com`, `*.recruitee.com`, `*.jobs.personio.de`, `myworkdayjobs.com`, `applytojob.com`, `ats.rippling.com`

## Sources
Research drawn from the pasted notes referencing the Mersetti/ats-job-board-apis and adderleydata/ats-job-board-api READMEs, cleanjobdata.com, pipeworx.io, Apify aggregator listing, and the career-ops supported boards doc. Re-verify before relying on any endpoint.
