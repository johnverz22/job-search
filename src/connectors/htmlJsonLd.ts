import { isFresh } from '../detailCache.js';
import { getText } from '../http.js';
import { extractJobPostings, extractLinks, jobPostingToNormalized } from '../jsonld.js';
import type { Connector, NormalizedJob, Platform } from '../types.js';

/** Max job pages fetched per crawl (cached jobs do not count). */
const MAX_DETAIL = Number(process.env.MAX_DETAIL_FETCH ?? 300);

interface Config {
  platform: Platform;
  /** Listing URL; `page` is 0-based and only varies when `maxPages` > 1. */
  listUrl: (slug: string, page: number) => string;
  /** Listing pages to walk (stops early when a page adds no new jobs). Default 1. */
  maxPages?: number;
  /** Matches job detail URLs in the listing HTML; capture group 1 = stable job id. */
  linkPattern: (slug: string) => RegExp;
  /** Rewrites a listing link before the job page is fetched (e.g. drop tracking query params). */
  jobUrl?: (url: string) => string;
}

/**
 * Generic connector: fetch an HTML listing (optionally paginated), follow job links, read schema.org JobPosting JSON-LD
 * from each job page. Job pages are cached in the store (`raw` = the JobPosting) so a crawl only fetches new jobs and
 * ones older than DETAIL_TTL_HOURS; a failed page fetch falls back to the stored copy instead of dropping the job.
 */
export function htmlJsonLdConnector(cfg: Config): Connector {
  return {
    platform: cfg.platform,
    cachesDetail: true,
    async fetchJobs(slug, ctx) {
      const pattern = cfg.linkPattern(slug);
      const byKey = new Map<string, { url: string; id: string | null }>();
      for (let page = 0; page < (cfg.maxPages ?? 1); page++) {
        const listUrl = cfg.listUrl(slug, page);
        let html: string;
        try {
          html = await getText(listUrl, { minIntervalMs: 500 });
        } catch (e) {
          if (page === 0) throw e; // the first page decides whether the board exists; later pages just end the walk
          break;
        }
        const before = byKey.size;
        for (const l of extractLinks(html, listUrl, pattern)) {
          const key = l.id ?? l.url;
          if (!byKey.has(key)) byKey.set(key, { url: cfg.jobUrl ? cfg.jobUrl(l.url) : l.url, id: l.id });
        }
        if (byKey.size === before) break;
      }

      const out: NormalizedJob[] = [];
      let budget = MAX_DETAIL;
      for (const l of byKey.values()) {
        const ctxJob = { platform: cfg.platform, companySlug: slug, url: l.url, externalId: l.id ?? undefined };
        const prev = l.id ? ctx?.previous?.get(l.id) : undefined;
        const prevRaw = prev?.raw && typeof prev.raw === 'object' ? prev.raw : undefined;
        if (isFresh(prev) && prevRaw) {
          out.push({ ...jobPostingToNormalized(prevRaw, ctxJob), detailFetchedAt: prev.detailFetchedAt });
          continue;
        }
        let fetched: NormalizedJob | null = null;
        if (budget > 0) {
          budget--;
          try {
            const jp = extractJobPostings(await getText(l.url, { minIntervalMs: 500 }))[0];
            if (jp) fetched = { ...jobPostingToNormalized(jp, ctxJob), detailFetchedAt: new Date().toISOString() };
          } catch {
            /* fall through to the stale copy */
          }
        }
        if (fetched) out.push(fetched);
        else if (prevRaw) out.push({ ...jobPostingToNormalized(prevRaw, ctxJob), detailFetchedAt: prev?.detailFetchedAt ?? null });
        // else: no stored copy and nothing fetched; the job is picked up on a later crawl
      }
      return out;
    },
  };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Link patterns are unverified against live pages; see docs/planning/03-verification-checklist.md.
export const jazzhr = htmlJsonLdConnector({
  platform: 'jazzhr',
  listUrl: (slug) => `https://${slug}.applytojob.com/apply`,
  linkPattern: (slug) => new RegExp(`^https://${esc(slug)}\\.applytojob\\.com/apply/([A-Za-z0-9]+)(?:/|$|\\?)`),
});

export const jobvite = htmlJsonLdConnector({
  platform: 'jobvite',
  listUrl: (slug) => `https://jobs.jobvite.com/${slug}/jobs`,
  linkPattern: (slug) => new RegExp(`^https://jobs\\.jobvite\\.com/${esc(slug)}/job/([A-Za-z0-9]+)`),
});

/**
 * iCIMS career portals. `slug` is the portal subdomain, e.g. "careers-acme" for careers-acme.icims.com.
 * UNVERIFIED: listing paginates with `pr` (0-based) per the research notes; job links look like /jobs/{id}/{title}/job.
 */
export const icims = htmlJsonLdConnector({
  platform: 'icims',
  listUrl: (slug, page) => `https://${slug}.icims.com/jobs/search?ss=1&pr=${page}&in_iframe=1`,
  maxPages: Number(process.env.ICIMS_MAX_PAGES ?? 40),
  linkPattern: (slug) => new RegExp(`^https://${esc(slug)}\\.icims\\.com/jobs/(\\d+)/`),
  // Listing links carry layout/tracking params (width, height, jan1offset, ...); the bare job URL in iframe mode is enough.
  jobUrl: (url) => {
    const u = new URL(url);
    return `${u.origin}${u.pathname}?in_iframe=1`;
  },
});

/**
 * Y Combinator company job pages. `slug` is the YC company slug (ycombinator.com/companies/{slug}).
 * UNVERIFIED: assumes the /jobs listing links to /jobs/{id}-{title} pages that carry JobPosting JSON-LD, and that robots.txt allows it.
 */
export const yc = htmlJsonLdConnector({
  platform: 'yc',
  listUrl: (slug) => `https://www.ycombinator.com/companies/${slug}/jobs`,
  linkPattern: (slug) => new RegExp(`^https://www\\.ycombinator\\.com/companies/${esc(slug)}/jobs/([A-Za-z0-9]+)`),
});
