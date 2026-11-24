import { getJson } from '../http.js';
import type { Connector, NormalizedJob } from '../types.js';
import { arr, iso, joinParts, str } from '../util.js';

// Response shape is NOT yet verified against the live API; parsing is defensive. Verify with `npm run cli -- probe rippling <slug>`.
export function normalizeRippling(slug: string, items: any[]): NormalizedJob[] {
  return items.map((j) => {
    const id = String(j.uuid ?? j.id ?? j.jobId ?? j.url);
    const locs = [
      ...arr<any>(j.locations).map((l) => (typeof l === 'string' ? l : str(l?.name) ?? joinParts(l?.city, l?.state, l?.country))),
      ...(j.workLocation ? [typeof j.workLocation === 'string' ? j.workLocation : str(j.workLocation.name)] : []),
    ].filter((x): x is string => !!x);
    const wt = str(j.workplaceType ?? j.workType)?.toLowerCase();
    return {
      platform: 'rippling',
      companySlug: slug,
      externalId: id,
      title: String(j.name ?? j.title ?? ''),
      descriptionHtml: str(j.description),
      locations: locs,
      remote: wt ? wt.includes('remote') : null,
      department: str(j.department?.name ?? j.department),
      employmentType: str(j.employmentType?.label ?? j.employmentType),
      seniority: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryText: null,
      postedAt: iso(j.createdAt ?? j.postedAt),
      applyUrl: str(j.url) ?? `https://ats.rippling.com/${slug}/jobs/${id}`,
      raw: j,
    } satisfies NormalizedJob;
  });
}

export function ripplingItems(data: any): any[] {
  return Array.isArray(data) ? data : arr(data?.items ?? data?.jobs ?? data?.results);
}

export const rippling: Connector = {
  platform: 'rippling',
  async fetchJobs(slug) {
    const pageSize = 1000;
    const all: any[] = [];
    for (let page = 0; page < 50; page++) {
      const data = await getJson(`https://api.rippling.com/platform/api/ats/v2/board/${slug}/jobs?page=${page}&pageSize=${pageSize}`);
      const items = ripplingItems(data);
      all.push(...items);
      const totalPages = typeof data?.totalPages === 'number' ? data.totalPages : null;
      if (items.length < pageSize || (totalPages !== null && page + 1 >= totalPages)) break;
    }
    return normalizeRippling(slug, all);
  },
};
