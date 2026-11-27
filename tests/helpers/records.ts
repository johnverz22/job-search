import { toRecord, type Aggregator, type JobRecord, type SourceState } from '../../src/model.js';
import type { NormalizedJob } from '../../src/types.js';

export const normalized = (externalId: string, o: Partial<NormalizedJob> = {}): NormalizedJob => ({
  platform: 'gem', companySlug: 'acme', externalId, title: `Job ${externalId}`, descriptionHtml: null, locations: [], remote: null,
  department: null, employmentType: null, seniority: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryText: null,
  postedAt: null, applyUrl: null, raw: null, ...o,
});

export const record = (externalId: string, o: Partial<NormalizedJob> = {}, firstSeen = new Date().toISOString()): JobRecord =>
  toRecord(normalized(externalId, o), undefined, new Date(firstSeen));

/** A static Aggregator for HTTP and facet tests. `set` publishes a new array. */
export function fakeAggregator(initial: JobRecord[] = [], extra: { states?: SourceState[]; progress?: ReturnType<Aggregator['progress']> } = {}) {
  let records: readonly JobRecord[] = initial;
  let version = 1;
  const agg = {
    all: () => records,
    get: (id: string) => records.find((r) => r.id === id),
    version: () => version,
    states: () => extra.states ?? [],
    progress: () => extra.progress ?? { ready: true, total: 0, done: 0 },
    start() {},
    async stop() {},
    set(next: JobRecord[]) { records = next; version++; },
  } satisfies Aggregator & { set(next: JobRecord[]): void };
  return agg;
}
