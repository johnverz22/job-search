import { describe, expect, it } from 'vitest';
import { aggregatorFromSnapshot } from '../src/readOnly.js';
import { record } from './helpers/records.js';

const entries = [
  { platform: 'gem' as const, slug: 'acme' },
  { platform: 'gem' as const, slug: 'missing' },
];

describe('aggregatorFromSnapshot', () => {
  it('serves snapshot records read-only and always reports ready', () => {
    const r1 = record('1', { title: 'Dev' });
    const r2 = record('2', { title: 'Ops' });
    const agg = aggregatorFromSnapshot(entries, [{ platform: 'gem', slug: 'acme', lastOkAt: '2026-11-26T00:00:00Z', records: [r1, r2] }]);
    expect(agg.all()).toEqual([r1, r2]);
    expect(agg.get(r1.id)).toBe(r1);
    expect(agg.progress()).toEqual({ ready: true, total: 2, done: 2 });
    expect(agg.states()).toEqual([
      { platform: 'gem', slug: 'acme', status: 'ok', jobs: 2, lastAttemptAt: '2026-11-26T00:00:00Z', lastOkAt: '2026-11-26T00:00:00Z', lastError: null, failures: 0, nextDueAt: '9999-01-01T00:00:00.000Z' },
      { platform: 'gem', slug: 'missing', status: 'pending', jobs: 0, lastAttemptAt: null, lastOkAt: null, lastError: null, failures: 0, nextDueAt: '9999-01-01T00:00:00.000Z' },
    ]);
    agg.start();
    expect(agg.all()).toHaveLength(2); // start/stop are no-ops: nothing is crawled
  });

  it('is empty but ready with no snapshot', () => {
    const agg = aggregatorFromSnapshot(entries, null);
    expect(agg.all()).toEqual([]);
    expect(agg.progress()).toEqual({ ready: true, total: 2, done: 2 });
  });
});
