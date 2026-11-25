import { readFileSync } from 'node:fs';
import { pool } from './db.js';
import { getText } from './http.js';
import { detectAts, dedupe, discoverablePlatforms, extractSlug, type Candidate } from './discovery/patterns.js';
import { discoverCustomDomains } from './discovery/customDomains.js';
import { commonCrawlCandidates, crtshCandidates } from './discovery/sources.js';
import { upsertCandidates, validateBatch } from './discovery/store.js';
import { PLATFORMS, type Platform } from './types.js';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['dry'].includes(args[i - 1].slice(2))));
const [cmd, target] = pos;

const usage = `usage: discover <command> [--dry]
  crtsh <platform>              hostnames from Certificate Transparency (subdomain platforms)
  cc <platform> [--pages N] [--crawl CC-MAIN-YYYY-WW]   Common Crawl index (N index pages, default 5)
  urls <file|->                 extract slugs from a file of URLs (one per line), e.g. exported search results
  page <url>                    detect ATS boards linked/embedded on a company careers page
  domains <file|->              seed list of company domains/careers URLs (one per line): scan their careers pages and probe
                                the hosts for custom-domain Recruitee/Personio/Rippling/Teamtailor boards
  validate [--limit N]          probe unvalidated candidates; enable the valid ones (default 100)
platforms: ${discoverablePlatforms.join(', ')}
--dry prints candidates without touching the database`;

async function save(cands: Candidate[], via: string) {
  cands = dedupe(cands);
  const byPlatform = cands.reduce<Record<string, number>>((a, c) => ((a[c.platform] = (a[c.platform] ?? 0) + 1), a), {});
  console.log(`found ${cands.length} unique candidates`, byPlatform);
  if (flag('dry')) { console.log(cands.slice(0, 50)); return; }
  console.log(`inserted ${await upsertCandidates(cands, via)} new sources (disabled until validated)`);
}

async function main() {
  const platform = target as Platform;
  if (cmd === 'crtsh' && PLATFORMS.includes(platform)) await save(await crtshCandidates(platform), 'crtsh');
  else if (cmd === 'cc' && PLATFORMS.includes(platform)) await save(await commonCrawlCandidates(platform, { maxPages: Number(opt('pages') ?? 5), crawl: opt('crawl') }), 'commoncrawl');
  else if (cmd === 'urls' && target) {
    const text = target === '-' ? readFileSync(0, 'utf8') : readFileSync(target, 'utf8');
    await save(text.split(/\r?\n/).map((l) => extractSlug(l.trim())).filter((c): c is Candidate => !!c), 'urls');
  } else if (cmd === 'domains' && target) {
    const text = target === '-' ? readFileSync(0, 'utf8') : readFileSync(target, 'utf8');
    await save(await discoverCustomDomains(text.split(/\r?\n/)), 'domains');
  } else if (cmd === 'page' && target) await save(detectAts(await getText(target), target), `page:${target}`.slice(0, 200));
  else if (cmd === 'validate') console.log(await validateBatch(Number(opt('limit') ?? 100)));
  else { console.log(usage); process.exitCode = 1; }
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
