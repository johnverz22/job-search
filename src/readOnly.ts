/** An Aggregator preloaded from a snapshot file, for serverless deploys that cannot run the crawl loop. */
import type { Aggregator, JobRecord, SourceEntry, SourceState } from './model.js';
import type { SnapshotSource } from './snapshot.js';

const NEVER_DUE = '9999-01-01T00:00:00.000Z';

/**
 * `entries` are the configured sources (for the status page); `saved` is what readSnapshot() returned,
 * or null when there is no snapshot yet. Sources missing from the snapshot report as pending with no jobs.
 * progress() is always ready: the data is final, there is nothing left to collect.
 */
export function aggregatorFromSnapshot(entries: readonly SourceEntry[], saved: readonly SnapshotSource[] | null): Aggregator {
  const bySource = new Map((saved ?? []).map((s) => [`${s.platform}/${s.slug}`, s]));
  const all: JobRecord[] = (saved ?? []).flatMap((s) => s.records);
  const byId = new Map(all.map((r) => [r.id, r]));
  const states: SourceState[] = entries.map((e) => {
    const hit = bySource.get(`${e.platform}/${e.slug}`);
    return hit
      ? {
        platform: e.platform, slug: e.slug, status: 'ok', jobs: hit.records.length,
        lastAttemptAt: hit.lastOkAt, lastOkAt: hit.lastOkAt, lastError: null, failures: 0, nextDueAt: NEVER_DUE,
      }
      : {
        platform: e.platform, slug: e.slug, status: 'pending', jobs: 0,
        lastAttemptAt: null, lastOkAt: null, lastError: null, failures: 0, nextDueAt: NEVER_DUE,
      };
  });
  return {
    all: () => all,
    get: (id) => byId.get(id),
    version: () => 1,
    states: () => states,
    progress: () => ({ ready: true, total: entries.length, done: entries.length }),
    start() {},
    async stop() {},
  };
}
