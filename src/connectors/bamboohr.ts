import { getJson } from '../http.js';
import type { Connector, NormalizedJob } from '../types.js';
import { arr, iso, joinParts, str } from '../util.js';

// Undocumented endpoints used by BambooHR's own careers pages. Invalid subdomains may redirect instead of 404,
// so we require a JSON body with a `result` array.
export function normalizeBamboo(slug: string, listItem: any, detail?: any): NormalizedJob {
  const d = detail?.result?.jobOpening ?? {};
  const loc = listItem.location ?? d.location ?? {};
  const locStr = typeof loc === 'string' ? loc : joinParts(loc.city, loc.state, loc.addressCountry ?? loc.country);
  const type = str(listItem.locationType ?? d.locationType);
  const id = String(listItem.id);
  return {
    platform: 'bamboohr',
    companySlug: slug,
    externalId: id,
    title: String(listItem.jobOpeningName ?? d.jobOpeningName ?? ''),
    descriptionHtml: str(d.description),
    locations: locStr ? [locStr] : [],
    remote: listItem.isRemote === true || type === '1' ? true : listItem.isRemote === false ? false : null,
    department: str(listItem.departmentLabel ?? d.departmentLabel),
    employmentType: str(listItem.employmentStatusLabel ?? d.employmentStatusLabel),
    seniority: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryText: str(d.compensation),
    postedAt: iso(d.datePosted),
    applyUrl: `https://${slug}.bamboohr.com/careers/${id}`,
    raw: { list: listItem, detail: detail?.result ?? null },
  };
}

export const bamboohr: Connector = {
  platform: 'bamboohr',
  async fetchJobs(slug) {
    const list = await getJson<any>(`https://${slug}.bamboohr.com/careers/list`);
    if (!Array.isArray(list?.result)) throw new Error(`bamboohr/${slug}: unexpected list response (invalid subdomain?)`);
    const out: NormalizedJob[] = [];
    for (const item of arr<any>(list.result)) {
      let detail: any;
      try {
        detail = await getJson(`https://${slug}.bamboohr.com/careers/${item.id}/detail`, { minIntervalMs: 500 });
      } catch {
        detail = undefined; // keep the job even if the detail fetch fails
      }
      out.push(normalizeBamboo(slug, item, detail));
    }
    return out;
  },
};
