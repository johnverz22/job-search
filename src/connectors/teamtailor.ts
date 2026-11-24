import { XMLParser } from 'fast-xml-parser';
import { getText } from '../http.js';
import type { Connector, NormalizedJob } from '../types.js';
import { arr, iso, str } from '../util.js';

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === 'item' || name === 'tt:location',
});

// Remote status values are not verified against live feeds yet; unknown values map to null.
const remoteFrom = (v: unknown): boolean | null => {
  const s = str(v)?.toLowerCase();
  if (!s) return null;
  if (['fully', 'full', 'remote', 'yes'].includes(s)) return true;
  if (['none', 'onsite', 'on-site', 'no'].includes(s)) return false;
  return null;
};

/** `slug` is the careers host, e.g. "acme.teamtailor.com" or a custom domain. */
export function normalizeTeamtailor(slug: string, xml: string): NormalizedJob[] {
  const doc = parser.parse(xml);
  return arr<any>(doc?.rss?.channel?.item).map((it) => {
    const locs = arr<any>(it['tt:locations']?.['tt:location'])
      .map((l) => [str(l['tt:city']), str(l['tt:country'])].filter(Boolean).join(', ') || str(l['tt:name']))
      .filter((x): x is string => !!x);
    const link = str(it.link);
    return {
      platform: 'teamtailor',
      companySlug: slug,
      externalId: str(it.guid) ?? link ?? String(it.title),
      title: String(it.title ?? ''),
      descriptionHtml: str(it.description),
      locations: locs,
      remote: remoteFrom(it.remoteStatus ?? it['tt:remoteStatus']),
      department: str(it['tt:department']),
      employmentType: null,
      seniority: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryText: null,
      postedAt: iso(it.pubDate),
      applyUrl: link,
      raw: it,
    } satisfies NormalizedJob;
  });
}

export const teamtailor: Connector = {
  platform: 'teamtailor',
  async fetchJobs(slug) {
    return normalizeTeamtailor(slug, await getText(`https://${slug}/jobs.rss`));
  },
};
