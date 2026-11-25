import { getJson, getText, politeFetch, HttpError } from '../http.js';
import { dedupe, extractSlug, RULES, type Candidate } from './patterns.js';
import type { Platform } from '../types.js';

/** crt.sh JSON rows -> candidates. Certificates list hostnames only, so this works for subdomain-based platforms. */
export function parseCrtSh(rows: any[]): Candidate[] {
  const out: Candidate[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    for (const name of String(r?.name_value ?? '').split(/\r?\n/)) {
      const n = name.trim().toLowerCase();
      if (!n || n.includes('*')) continue;
      const c = extractSlug(n);
      if (c) out.push(c);
    }
  }
  return dedupe(out);
}

/** Common Crawl CDX NDJSON (`fl=url&output=json`) -> candidates. */
export function parseCdxLines(body: string): Candidate[] {
  const out: Candidate[] = [];
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    try {
      const url = JSON.parse(line)?.url;
      const c = url ? extractSlug(String(url)) : null;
      if (c) out.push(c);
    } catch { /* skip */ }
  }
  return dedupe(out);
}

export async function crtshCandidates(platform: Platform, log = console.log): Promise<Candidate[]> {
  const rule = RULES.find((r) => r.platform === platform);
  if (!rule?.crt) throw new Error(`crt.sh not applicable to ${platform} (its slug needs more than a hostname); use cc`);
  const all: Candidate[] = [];
  for (const q of rule.crt) {
    log(`crt.sh: ${q}`);
    // crt.sh is a free community service and is slow/flaky for big domains; be patient and gentle.
    const rows = await getJson<any[]>(`https://crt.sh/?q=${encodeURIComponent(q)}&exclude=expired&output=json`, { timeoutMs: 180000, retries: 2, minIntervalMs: 3000 });
    all.push(...parseCrtSh(rows));
  }
  return dedupe(all);
}

export async function commonCrawlCandidates(platform: Platform, opts: { maxPages?: number; crawl?: string } = {}, log = console.log): Promise<Candidate[]> {
  const rule = RULES.find((r) => r.platform === platform);
  if (!rule) throw new Error(`unknown platform ${platform}`);
  const info = await getJson<any[]>('https://index.commoncrawl.org/collinfo.json', { timeoutMs: 30000 });
  const cdx: string = opts.crawl ? `https://index.commoncrawl.org/${opts.crawl}-index` : info[0]['cdx-api'];
  log(`common crawl index: ${cdx}`);
  const maxPages = opts.maxPages ?? 5;
  const all: Candidate[] = [];
  for (const q of rule.cc) {
    const base = `${cdx}?url=${encodeURIComponent(q)}&output=json&fl=url&filter=status:200`;
    let pages = 1;
    try {
      const meta = await getText(`${base}&showNumPages=true`, { timeoutMs: 60000, minIntervalMs: 1500 });
      pages = Number(JSON.parse(meta.trim().split('\n')[0])?.pages ?? 1) || 1;
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) { log(`  no captures for ${q}`); continue; }
      log(`  page count unavailable for ${q}, trying page 0 only`);
    }
    const n = Math.min(pages, maxPages);
    log(`  ${q}: ${pages} index pages, fetching ${n}`);
    for (let p = 0; p < n; p++) {
      const res = await politeFetch(`${base}&page=${p}`, { timeoutMs: 120000, minIntervalMs: 1500 });
      if (!res.ok) { log(`  page ${p}: HTTP ${res.status}`); continue; }
      const cands = parseCdxLines(await res.text());
      all.push(...cands);
      log(`  page ${p}: +${cands.length} (unique so far ${dedupe(all).length})`);
    }
  }
  return dedupe(all);
}
