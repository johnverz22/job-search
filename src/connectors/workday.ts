import { isFresh } from '../detailCache.js';
import { getJson } from '../http.js';
import type { Connector, FetchContext, NormalizedJob, PreviousJob } from '../types.js';
import { arr, iso, str } from '../util.js';

// Workday "CXS" endpoints: the JSON API behind every {tenant}.wd{N}.myworkdayjobs.com careers site. Unauthenticated but
// browser-facing, not a documented public API, so everything here is UNVERIFIED against live tenants (no network in the
// sandbox it was written in). Probe with: npm run cli -- probe workday <tenant>.<wdN>/<site>

/** Workday returns at most this many results per query (offset + limit beyond it comes back empty). */
export const WORKDAY_RESULT_CAP = 2000;
const PAGE_SIZE = 20; // largest `limit` the endpoint accepts
const MAX_SPLIT_DEPTH = 3;
const DETAIL_BUDGET = Number(process.env.WORKDAY_DETAIL_BUDGET ?? 300);

export interface WorkdaySlug {
  tenant: string;
  wd: string;
  site: string;
}

/** Slug format: `{tenant}.{wdN}/{site}`, e.g. `nvidia.wd5/NVIDIAExternalCareerSite`. */
export function parseWorkdaySlug(slug: string): WorkdaySlug {
  const m = slug.match(/^([a-z0-9-]+)\.(wd\d+)\/([A-Za-z0-9_-]+)$/i);
  if (!m) throw new Error(`workday: bad slug "${slug}" (expected {tenant}.{wdN}/{site})`);
  return { tenant: m[1].toLowerCase(), wd: m[2].toLowerCase(), site: m[3] };
}

export interface FacetLeaf {
  param: string;
  id: string;
  count: number;
}

/** Flattens the `facets` of a CXS response into selectable values grouped by the `appliedFacets` parameter name. */
export function facetLeaves(facets: unknown): Map<string, FacetLeaf[]> {
  const out = new Map<string, FacetLeaf[]>();
  const add = (param: unknown, v: any) => {
    const id = str(v?.id);
    const count = Number(v?.count);
    if (typeof param !== 'string' || !id || !Number.isFinite(count) || count <= 0) return;
    if (!out.has(param)) out.set(param, []);
    out.get(param)!.push({ param, id, count });
  };
  for (const f of arr<any>(facets)) {
    for (const v of arr<any>(f?.values)) {
      // Grouped facets (e.g. locationMainGroup -> locations / locationRegionStateProvince) nest their real values one level down.
      if (Array.isArray(v?.values)) for (const c of v.values) add(v.facetParameter ?? f.facetParameter, c);
      else add(f.facetParameter, v);
    }
  }
  return out;
}

/**
 * Picks the facet to split a >2,000-result query on: not already applied, at least two values, and covering as many of the
 * `total` results as possible (ties: the one whose biggest bucket is smallest). Null if nothing usable is left.
 */
export function pickSplitFacet(facets: unknown, applied: Record<string, string[]>, total: number): { param: string; leaves: FacetLeaf[]; covered: number } | null {
  let best: { param: string; leaves: FacetLeaf[]; covered: number; maxLeaf: number } | null = null;
  for (const [param, leaves] of facetLeaves(facets)) {
    if (param in applied || leaves.length < 2) continue;
    const covered = Math.min(total, leaves.reduce((n, l) => n + l.count, 0));
    const maxLeaf = Math.max(...leaves.map((l) => l.count));
    if (!best || covered > best.covered || (covered === best.covered && maxLeaf < best.maxLeaf)) best = { param, leaves, covered, maxLeaf };
  }
  return best && { param: best.param, leaves: best.leaves, covered: best.covered };
}

/** Stable id: the requisition id from `bulletFields` when present, else the job's path. */
export function workdayId(item: any): string {
  const req = arr<any>(item?.bulletFields).map(str).find((x): x is string => !!x);
  return req ?? String(item?.externalPath ?? '').replace(/^\//, '');
}

const baseUrl = (s: WorkdaySlug) => `https://${s.tenant}.${s.wd}.myworkdayjobs.com`;
const isCountLabel = (x: string) => /^\d+\s+locations?$/i.test(x);

export function normalizeWorkday(slug: string, item: any, info?: any, detailFetchedAt: string | null = null): NormalizedJob {
  const s = parseWorkdaySlug(slug);
  const d = info ?? {};
  const locs = [str(d.location), ...arr(d.additionalLocations).map(str)].filter((x): x is string => !!x);
  const listLoc = str(item.locationsText);
  if (!locs.length && listLoc && !isCountLabel(listLoc)) locs.push(listLoc); // "2 Locations" says nothing; wait for the detail
  const remote = str(d.remoteType)?.toLowerCase();
  const path = String(item.externalPath ?? '');
  return {
    platform: 'workday',
    companySlug: slug,
    externalId: workdayId(item),
    title: String(item.title ?? d.title ?? ''),
    descriptionHtml: str(d.jobDescription),
    locations: locs,
    remote: remote ? remote.includes('remote') : null,
    department: null,
    employmentType: str(d.timeType),
    seniority: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryText: null,
    postedAt: iso(d.startDate),
    applyUrl: str(d.externalUrl) ?? `${baseUrl(s)}/${s.site}${path}`,
    raw: { list: item, detail: info ?? null },
    detailFetchedAt: info ? detailFetchedAt : null,
  };
}

interface Page {
  total: number | null;
  jobPostings: any[];
  facets: unknown;
}

async function listPage(s: WorkdaySlug, applied: Record<string, string[]>, offset: number): Promise<Page> {
  const data = await getJson<any>(`${baseUrl(s)}/wday/cxs/${s.tenant}/${s.site}/jobs`, {
    method: 'POST',
    body: { appliedFacets: applied, limit: PAGE_SIZE, offset, searchText: '' },
    minIntervalMs: 400,
  });
  if (!Array.isArray(data?.jobPostings)) throw new Error(`workday/${s.tenant}: unexpected list response (bad tenant or site?)`);
  // `total` is only reliable on the first page (offset 0); later pages may report 0.
  return { total: typeof data.total === 'number' ? data.total : null, jobPostings: data.jobPostings, facets: data.facets };
}

/** Lists every posting; queries over the 2,000 cap are split by facet (location, job family, ...) and merged by id. */
async function listAll(s: WorkdaySlug, applied: Record<string, string[]>, depth: number, seen: Map<string, any>): Promise<void> {
  const first = await listPage(s, applied, 0);
  const total = first.total ?? first.jobPostings.length;
  if (total > WORKDAY_RESULT_CAP && depth < MAX_SPLIT_DEPTH) {
    const pick = pickSplitFacet(first.facets, applied, total);
    if (pick) {
      if (pick.covered < total * 0.95) console.warn(`workday/${s.tenant}: facet ${pick.param} covers ${pick.covered}/${total} postings; the rest is not reachable`);
      for (const leaf of pick.leaves) await listAll(s, { ...applied, [pick.param]: [leaf.id] }, depth + 1, seen);
      return;
    }
    console.warn(`workday/${s.tenant}: ${total} postings but no facet left to split on; keeping the first ${WORKDAY_RESULT_CAP}`);
  }
  for (const it of first.jobPostings) seen.set(workdayId(it), it);
  const limit = Math.min(total > 0 ? total : WORKDAY_RESULT_CAP, WORKDAY_RESULT_CAP);
  for (let offset = PAGE_SIZE; offset < limit; offset += PAGE_SIZE) {
    const page = await listPage(s, applied, offset);
    if (!page.jobPostings.length) break;
    for (const it of page.jobPostings) seen.set(workdayId(it), it);
  }
}

export async function fetchWorkday(slug: string, ctx?: FetchContext): Promise<NormalizedJob[]> {
  const s = parseWorkdaySlug(slug);
  const seen = new Map<string, any>();
  await listAll(s, {}, 0, seen);

  const out: NormalizedJob[] = [];
  let budget = DETAIL_BUDGET;
  for (const [id, item] of seen) {
    const prev: PreviousJob | undefined = ctx?.previous?.get(id);
    const prevDetail = (prev?.raw as { detail?: any } | undefined)?.detail ?? null;
    if (isFresh(prev) && prevDetail) {
      out.push(normalizeWorkday(slug, item, prevDetail, prev.detailFetchedAt));
      continue;
    }
    let info: any = null;
    let fetchedAt: string | null = null;
    if (budget > 0 && item.externalPath) {
      budget--;
      try {
        const detail = await getJson<any>(`${baseUrl(s)}/wday/cxs/${s.tenant}/${s.site}${item.externalPath}`, { minIntervalMs: 400 });
        info = detail?.jobPostingInfo ?? null;
        if (info) fetchedAt = new Date().toISOString();
      } catch {
        /* keep the job; fall back to the stale stored detail below */
      }
    }
    if (!info && prevDetail) {
      info = prevDetail;
      fetchedAt = prev?.detailFetchedAt ?? null;
    }
    out.push(normalizeWorkday(slug, item, info, fetchedAt));
  }
  return out;
}

export const workday: Connector = { platform: 'workday', cachesDetail: true, fetchJobs: fetchWorkday };
