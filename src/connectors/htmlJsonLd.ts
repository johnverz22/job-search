import { getText } from '../http.js';
import { extractJobPostings, extractLinks, jobPostingToNormalized } from '../jsonld.js';
import type { Connector, NormalizedJob, Platform } from '../types.js';

const MAX_DETAIL = Number(process.env.MAX_DETAIL_FETCH ?? 300);

interface Config {
  platform: Platform;
  listUrl: (slug: string) => string;
  /** Matches job detail URLs in the listing HTML; capture group 1 = stable job id. */
  linkPattern: (slug: string) => RegExp;
}

/** Generic connector: fetch an HTML listing, follow job links, read schema.org JobPosting JSON-LD from each job page. */
export function htmlJsonLdConnector(cfg: Config): Connector {
  return {
    platform: cfg.platform,
    async fetchJobs(slug) {
      const listUrl = cfg.listUrl(slug);
      const html = await getText(listUrl, { minIntervalMs: 500 });
      const links = extractLinks(html, listUrl, cfg.linkPattern(slug)).slice(0, MAX_DETAIL);
      const out: NormalizedJob[] = [];
      for (const l of links) {
        try {
          const page = await getText(l.url, { minIntervalMs: 500 });
          const jp = extractJobPostings(page)[0];
          if (jp) out.push(jobPostingToNormalized(jp, { platform: cfg.platform, companySlug: slug, url: l.url, externalId: l.id ?? undefined }));
        } catch {
          /* skip a single failed job page; it stays open only if seen in a later pass */
        }
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
