import type { Db } from './app.js';

export const FACET_LIMIT = 50;
export const FACET_TTL_MS = 5 * 60_000;

export interface FacetValue {
  value: string;
  count: number;
}
export interface Facets {
  platform: FacetValue[];
  employment_type: FacetValue[];
  seniority: FacetValue[];
  department: FacetValue[];
  location: FacetValue[];
  salary_currency: FacetValue[];
}

/** One round trip: top values (by open-job count) for every filterable column. Locations are unnested from the array. */
export const FACETS_SQL = `
  SELECT facet, value, count FROM (
    SELECT facet, value, count, row_number() OVER (PARTITION BY facet ORDER BY count DESC, value) AS rn FROM (
      SELECT 'platform' AS facet, platform AS value, count(*)::int AS count FROM jobs WHERE status='open' GROUP BY 2
      UNION ALL SELECT 'employment_type', employment_type, count(*)::int FROM jobs WHERE status='open' AND employment_type IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'seniority', seniority, count(*)::int FROM jobs WHERE status='open' AND seniority IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'department', department, count(*)::int FROM jobs WHERE status='open' AND department IS NOT NULL GROUP BY 2
      UNION ALL SELECT 'location', loc, count(*)::int FROM jobs, unnest(locations) AS loc WHERE status='open' GROUP BY 2
      UNION ALL SELECT 'salary_currency', upper(salary_currency), count(*)::int FROM jobs WHERE status='open' AND salary_currency IS NOT NULL GROUP BY 2
    ) all_facets WHERE value <> ''
  ) ranked WHERE rn <= ${FACET_LIMIT} ORDER BY facet, count DESC, value`;

const empty = (): Facets => ({ platform: [], employment_type: [], seniority: [], department: [], location: [], salary_currency: [] });

export async function loadFacets(db: Db): Promise<Facets> {
  const { rows } = await db.query<{ facet: keyof Facets; value: string; count: number }>(FACETS_SQL);
  const out = empty();
  for (const r of rows) out[r.facet]?.push({ value: r.value, count: Number(r.count) });
  return out;
}

/** In-memory cache so a busy UI does not rerun the aggregate on every page load. */
export function cachedFacets(db: Db, ttlMs = FACET_TTL_MS, now: () => number = Date.now) {
  let hit: { at: number; value: Facets } | null = null;
  let inflight: Promise<Facets> | null = null;
  return async (): Promise<Facets> => {
    if (hit && now() - hit.at < ttlMs) return hit.value;
    inflight ??= loadFacets(db).then((value) => { hit = { at: now(), value }; return value; }).finally(() => { inflight = null; });
    return inflight;
  };
}
