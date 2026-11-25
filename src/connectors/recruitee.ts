import { getJson } from '../http.js';
import type { Connector, NormalizedJob } from '../types.js';
import { arr, iso, joinParts, num, str } from '../util.js';

// NOTE: unauthenticated access is documented to end 2027-02-10 (then X-Careers-Sites-Token is required). See docs/planning.
export function normalizeRecruitee(slug: string, data: any): NormalizedJob[] {
  return arr<any>(data?.offers).map((o) => {
    const locs = arr<any>(o.locations)
      .map((l) => joinParts(l.city, l.country))
      .filter(Boolean);
    const fallback = str(o.location) ?? joinParts(o.city, o.country);
    const s = o.salary ?? {};
    const min = num(s.min);
    const max = num(s.max);
    return {
      platform: 'recruitee',
      companySlug: slug,
      externalId: String(o.id),
      title: String(o.title ?? ''),
      descriptionHtml: [str(o.description), str(o.requirements)].filter(Boolean).join('\n') || null,
      locations: locs.length ? locs : fallback ? [fallback] : [],
      remote: typeof o.remote === 'boolean' ? o.remote : null,
      department: str(o.department),
      employmentType: str(o.employment_type_code),
      seniority: str(o.experience_code),
      salaryMin: min,
      salaryMax: max,
      salaryCurrency: str(s.currency),
      salaryText: min != null || max != null ? `${min ?? ''}-${max ?? ''} ${s.currency ?? ''} ${s.period ?? ''}`.trim() : null,
      postedAt: iso(o.published_at ?? o.created_at),
      applyUrl: str(o.careers_apply_url) ?? str(o.careers_url),
      raw: o,
    } satisfies NormalizedJob;
  });
}

/** `slug` is the subdomain ("acme"), or the full careers host for a custom domain ("careers.acme.com"; contains a dot). */
export const recruiteeHost = (slug: string) => (slug.includes('.') ? slug : `${slug}.recruitee.com`);

/** True if a response body looks like a Recruitee offers payload (used to probe custom domains). */
export const isRecruiteeOffers = (data: unknown): boolean => Array.isArray((data as any)?.offers);

export const recruitee: Connector = {
  platform: 'recruitee',
  async fetchJobs(slug) {
    const data = await getJson(`https://${recruiteeHost(slug)}/api/offers/`);
    if (slug.includes('.') && !isRecruiteeOffers(data)) throw new Error(`recruitee/${slug}: not a Recruitee careers site`);
    return normalizeRecruitee(slug, data);
  },
};
