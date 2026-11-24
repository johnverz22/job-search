import { getJson } from '../http.js';
import type { Connector, NormalizedJob } from '../types.js';
import { arr, iso, str } from '../util.js';

// Verified: GET https://api.gem.com/job_board/v0/{board}/job_posts/ returns a JSON array (keyless, documented by Gem).
// `slug` is the board name from jobs.gem.com/{board} (lower case).
export function normalizeGem(slug: string, data: any): NormalizedJob[] {
  const posts = Array.isArray(data) ? data : arr<any>(data?.job_posts ?? data?.jobs);
  return posts.map((p) => {
    const officeLocs = arr<any>(p.offices).map((o) => str(o?.location?.name) ?? str(o?.name)).filter((x): x is string => !!x);
    const locs = officeLocs.length ? officeLocs : [str(p.location?.name)].filter((x): x is string => !!x);
    const lt = str(p.location_type);
    return {
      platform: 'gem',
      companySlug: slug,
      externalId: String(p.id),
      title: String(p.title ?? ''),
      descriptionHtml: str(p.content),
      locations: [...new Set(locs)],
      remote: lt === 'remote' ? true : lt === 'in_office' || lt === 'hybrid' ? false : null,
      department: str(arr<any>(p.departments)[0]?.name),
      employmentType: str(p.employment_type),
      seniority: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryText: null,
      postedAt: iso(p.first_published_at ?? p.created_at),
      applyUrl: str(p.absolute_url) ?? `https://jobs.gem.com/${slug}/${p.id}`,
      raw: p,
    } satisfies NormalizedJob;
  });
}

export const gem: Connector = {
  platform: 'gem',
  async fetchJobs(slug) {
    return normalizeGem(slug, await getJson(`https://api.gem.com/job_board/v0/${slug}/job_posts/`));
  },
};
