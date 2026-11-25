import { isFresh } from '../detailCache.js';
import { getJson } from '../http.js';
import type { Connector, NormalizedJob } from '../types.js';
import { arr, iso, joinParts, stableStringify, str } from '../util.js';

// Undocumented endpoints used by BambooHR's own careers pages. Invalid subdomains may redirect instead of 404,
// so we require a JSON body with a `result` array.
export function normalizeBamboo(slug: string, listItem: any, detail?: any, detailFetchedAt: string | null = null): NormalizedJob {
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
    detailFetchedAt: detail?.result ? detailFetchedAt : null,
  };
}

export const bamboohr: Connector = {
  platform: 'bamboohr',
  cachesDetail: true,
  async fetchJobs(slug, ctx) {
    const list = await getJson<any>(`https://${slug}.bamboohr.com/careers/list`);
    if (!Array.isArray(list?.result)) throw new Error(`bamboohr/${slug}: unexpected list response (invalid subdomain?)`);
    const out: NormalizedJob[] = [];
    for (const item of arr<any>(list.result)) {
      const prev = ctx?.previous?.get(String(item.id));
      const prevRaw = prev?.raw as { list?: unknown; detail?: unknown } | undefined;
      let detail: any;
      let fetchedAt: string | null;
      // Reuse the stored detail while it is fresh AND the list entry (title, department, location, ...) is unchanged.
      if (isFresh(prev) && prevRaw?.detail && stableStringify(prevRaw.list) === stableStringify(item)) {
        detail = { result: prevRaw.detail };
        fetchedAt = prev.detailFetchedAt;
      } else {
        try {
          detail = await getJson(`https://${slug}.bamboohr.com/careers/${item.id}/detail`, { minIntervalMs: 500 });
          fetchedAt = new Date().toISOString();
        } catch {
          // Keep the job even if the detail fetch fails; fall back to the stale stored detail if there is one.
          detail = prevRaw?.detail ? { result: prevRaw.detail } : undefined;
          fetchedAt = prevRaw?.detail ? prev?.detailFetchedAt ?? null : null;
        }
      }
      out.push(normalizeBamboo(slug, item, detail, fetchedAt));
    }
    return out;
  },
};
