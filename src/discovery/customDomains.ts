import { getJson, getText } from '../http.js';
import { isPersonioXml } from '../connectors/personio.js';
import { isRecruiteeOffers } from '../connectors/recruitee.js';
import { dedupe, detectAts, type Candidate } from './patterns.js';

/**
 * Custom-domain detection for ATSes that can be served from a company's own careers host (careers.acme.com):
 *  - Recruitee and Personio: probe the host for the same endpoint the vendor domain serves (`/api/offers/`, `/xml`). The
 *    candidate's slug is then the full host, which those connectors accept (a slug containing a dot is a host).
 *  - Rippling: boards are embedded from ats.rippling.com / api.rippling.com, so page-scanning (`detectAts`) finds the real slug.
 *  - Teamtailor custom domains are already handled by `detectAts` (asset signature).
 * Input is a seed list of company domains or careers-page URLs; there is no way to enumerate custom domains from the ATS side.
 */
export interface Fetchers {
  /** Page body, or null on any failure (404, TLS error, timeout, ...). */
  text(url: string): Promise<string | null>;
  json(url: string): Promise<unknown | null>;
}

export const liveFetchers: Fetchers = {
  async text(url) {
    try {
      return await getText(url, { retries: 1, timeoutMs: 15000 });
    } catch {
      return null; // 404, DNS/TLS failure, timeout: not a reachable site
    }
  },
  async json(url) {
    try {
      return await getJson(url, { retries: 1, timeoutMs: 15000 });
    } catch {
      return null;
    }
  },
};

/** Normalizes a seed line (bare domain or URL) to the pages worth fetching. Null for blanks and non-URLs. */
export function careersPages(line: string): string[] | null {
  const raw = line.trim();
  if (!raw || raw.startsWith('#')) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!u.hostname.includes('.')) return null;
  if (u.pathname.replace(/\/+$/, '') !== '') return [u.toString()]; // a specific careers page: use as given
  const bare = u.hostname.replace(/^www\./, '');
  return [`https://${u.hostname}/`, `https://careers.${bare}/`, `https://jobs.${bare}/`, `https://${bare}/careers`];
}

/** Probes one reachable host for a Recruitee or Personio careers site served on it. */
export async function probeHost(host: string, f: Fetchers = liveFetchers): Promise<Candidate[]> {
  const out: Candidate[] = [];
  if (isRecruiteeOffers(await f.json(`https://${host}/api/offers/`))) out.push({ platform: 'recruitee', slug: host });
  const xml = await f.text(`https://${host}/xml?language=en`);
  if (xml && isPersonioXml(xml)) out.push({ platform: 'personio', slug: host });
  return out;
}

/** Scans each seed's careers pages for ATS links/embeds and probes the reachable hosts for custom-domain Recruitee/Personio. */
export async function discoverCustomDomains(lines: string[], f: Fetchers = liveFetchers, log: (m: string) => void = console.log): Promise<Candidate[]> {
  const all: Candidate[] = [];
  for (const line of lines) {
    const pages = careersPages(line);
    if (!pages) continue;
    const probed = new Set<string>();
    const found: Candidate[] = [];
    for (const url of pages) {
      const html = await f.text(url);
      if (html === null) continue;
      found.push(...detectAts(html, url));
      const host = new URL(url).hostname;
      if (!probed.has(host)) {
        probed.add(host);
        // Already pointing at a vendor-hosted board? No need to also probe for the same vendor on the company's own host.
        const known = new Set(found.map((c) => c.platform));
        found.push(...(await probeHost(host, f)).filter((c) => !known.has(c.platform)));
      }
    }
    const uniq = dedupe(found);
    log(`${line.trim()}: ${uniq.length ? uniq.map((c) => `${c.platform}/${c.slug}`).join(', ') : 'nothing found'}`);
    all.push(...uniq);
  }
  return dedupe(all);
}
