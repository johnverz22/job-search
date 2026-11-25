import { htmlJsonLdConnector } from './htmlJsonLd.js';

/** Slug format: `{sub}/{pod}/{org}/{cws}` from https://{sub}.tbe.taleo.net/{pod}/ats/careers/v2/searchResults?org={org}&cws={cws}. */
export function parseTaleoSlug(slug: string) {
  const m = slug.match(/^([a-z0-9-]+)\/([a-z0-9]+)\/([A-Za-z0-9_-]+)\/(\d+)$/i);
  if (!m) throw new Error(`taleo: bad slug "${slug}" (expected {sub}/{pod}/{org}/{cws})`);
  return { sub: m[1].toLowerCase(), pod: m[2], org: m[3], cws: m[4] };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Oracle Taleo Business Edition ("TBE") career sections: HTML result pages, job pages with JSON-LD.
 * UNVERIFIED: the research notes describe 25 results per page but not the paging parameter. `pageNum` is a guess; if it is
 * wrong the next page repeats the first one, the walk stops (no new jobs) and only the first page of each board is ingested.
 * The classic `*.taleo.net/careersection` flavor is not supported.
 */
export const taleo = htmlJsonLdConnector({
  platform: 'taleo',
  listUrl: (slug, page) => {
    const t = parseTaleoSlug(slug);
    const base = `https://${t.sub}.tbe.taleo.net/${t.pod}/ats/careers/v2/searchResults?org=${t.org}&cws=${t.cws}`;
    return page === 0 ? base : `${base}&pageNum=${page + 1}`;
  },
  maxPages: Number(process.env.TALEO_MAX_PAGES ?? 40),
  linkPattern: (slug) => {
    const t = parseTaleoSlug(slug);
    return new RegExp(`^https://${esc(t.sub)}\\.tbe\\.taleo\\.net/${esc(t.pod)}/ats/careers/v2/viewRequisition\\?[^#]*?\\brid=(\\d+)`);
  },
});
