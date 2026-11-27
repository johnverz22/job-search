import type { Aggregator, JobRecord } from './model.js';

export const FACET_LIMIT = 50;

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

/** Top values (by job count, then value) for every filterable field. Locations are counted individually. */
export function computeFacets(all: readonly JobRecord[]): Facets {
  const counts: Record<keyof Facets, Map<string, number>> = {
    platform: new Map(), employment_type: new Map(), seniority: new Map(), department: new Map(), location: new Map(), salary_currency: new Map(),
  };
  const add = (facet: keyof Facets, value: string | null) => {
    if (value) counts[facet].set(value, (counts[facet].get(value) ?? 0) + 1);
  };
  for (const r of all) {
    add('platform', r.platform);
    add('employment_type', r.employmentType);
    add('seniority', r.seniority);
    add('department', r.department);
    for (const l of r.locations) add('location', l);
    add('salary_currency', r.salaryCurrency?.toUpperCase() ?? null);
  }
  const top = (m: Map<string, number>): FacetValue[] =>
    [...m].map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
      .slice(0, FACET_LIMIT);
  return {
    platform: top(counts.platform), employment_type: top(counts.employment_type), seniority: top(counts.seniority),
    department: top(counts.department), location: top(counts.location), salary_currency: top(counts.salary_currency),
  };
}

/** Recomputes only when the aggregator publishes a new version. */
export function cachedFacets(agg: Pick<Aggregator, 'all' | 'version'>): () => Facets {
  let hit: { version: number; value: Facets } | null = null;
  return () => {
    const version = agg.version();
    if (hit?.version !== version) hit = { version, value: computeFacets(agg.all()) };
    return hit.value;
  };
}
