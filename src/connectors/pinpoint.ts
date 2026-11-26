import { getJson } from '../http.js';
import type { Connector, NormalizedJob } from '../types.js';
import { arr, iso, joinParts, num, str } from '../util.js';

// Verified live: GET https://{sub}.pinpointhq.com/postings.json returns {"data": [...]}
// with flat fields (id, title, description, location, job.department, workplace_type_text,
// employment_type_text, compensation_{visible,currency,minimum,maximum}, deadline_at, url, path).
// There is no posted-date field; `deadline_at` is an application deadline, not a post date.
const name = (v: any): string | null => (typeof v === 'string' ? str(v) : str(v?.name));

export function normalizePinpoint(slug: string, data: any): NormalizedJob[] {
  const items = Array.isArray(data) ? data : arr<any>(data?.data ?? data?.postings ?? data?.jobs);
  return items.map((raw) => {
    const j = raw?.attributes ? { id: raw.id, ...raw.attributes } : raw; // tolerate JSON:API envelope
    const loc = typeof j.location === 'string' ? str(j.location) : joinParts(j.location?.name ?? j.location?.city, j.location?.province, j.location?.country) || null;
    const wt = str(j.workplace_type_text ?? j.workplace_type ?? j.workplaceType)?.toLowerCase();
    const visible = j.compensation_visible !== false;
    const comp = visible ? str(j.compensation ?? j.compensation_text) : null;
    const salMin = visible ? num(j.compensation_minimum) : null;
    const salMax = visible ? num(j.compensation_maximum) : null;
    const salCur = visible ? str(j.compensation_currency) : null;
    const id = String(j.id ?? j.uuid ?? j.url);
    return {
      platform: 'pinpoint',
      companySlug: slug,
      externalId: id,
      title: String(j.title ?? ''),
      descriptionHtml: [str(j.description), str(j.key_responsibilities), str(j.skills_knowledge_expertise), str(j.benefits)].filter(Boolean).join('\n') || null,
      locations: loc ? [loc] : [],
      remote: wt ? wt.includes('remote') : null,
      department: name(j.job?.department) ?? name(j.department),
      employmentType: str(j.employment_type_text ?? j.employment_type),
      seniority: null,
      salaryMin: salMin,
      salaryMax: salMax,
      salaryCurrency: salCur,
      salaryText: comp ?? (salMin != null || salMax != null ? `${salMin ?? ''}-${salMax ?? ''} ${salCur ?? ''}`.trim() : null),
      postedAt: iso(j.published_at ?? j.created_at ?? j.posted_at),
      applyUrl: str(j.url) ?? str(j.path) ?? `https://${slug}.pinpointhq.com/en/postings/${id}`,
      raw: raw,
    } satisfies NormalizedJob;
  });
}

export const pinpoint: Connector = {
  platform: 'pinpoint',
  async fetchJobs(slug) {
    return normalizePinpoint(slug, await getJson(`https://${slug}.pinpointhq.com/postings.json`));
  },
};
