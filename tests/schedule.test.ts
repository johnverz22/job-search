import { describe, expect, it, vi } from 'vitest';
import { dedupeKey, snapshotHash } from '../src/hash.js';
import { politeFetch } from '../src/http.js';
import { disableReason, nextDelayMs } from '../src/schedule.js';
import type { NormalizedJob } from '../src/types.js';

const mid = () => 0.5; // jitter factor exactly 1.0
const MIN = 60_000;

describe('nextDelayMs', () => {
  it('stays at base for changing sources', () => expect(nextDelayMs({ baseMs: 15 * MIN, unchangedCount: 0, failureCount: 0, rand: mid })).toBe(15 * MIN));
  it('backs off x2 per two unchanged crawls, capped', () => {
    expect(nextDelayMs({ baseMs: 15 * MIN, unchangedCount: 2, failureCount: 0, rand: mid })).toBe(30 * MIN);
    expect(nextDelayMs({ baseMs: 15 * MIN, unchangedCount: 4, failureCount: 0, rand: mid })).toBe(60 * MIN);
    expect(nextDelayMs({ baseMs: 15 * MIN, unchangedCount: 100, failureCount: 0, rand: mid })).toBe(24 * 60 * MIN);
  });
  it('failures back off exponentially, capped at 7 days', () => {
    expect(nextDelayMs({ baseMs: 15 * MIN, unchangedCount: 0, failureCount: 1, rand: mid })).toBe(30 * MIN);
    expect(nextDelayMs({ baseMs: 15 * MIN, unchangedCount: 0, failureCount: 3, rand: mid })).toBe(120 * MIN);
    expect(nextDelayMs({ baseMs: 15 * MIN, unchangedCount: 0, failureCount: 50, rand: mid })).toBe(7 * 24 * 60 * MIN);
  });
  it('applies +-10% jitter', () => {
    expect(nextDelayMs({ baseMs: 1000, unchangedCount: 0, failureCount: 0, rand: () => 0 })).toBe(900);
    expect(nextDelayMs({ baseMs: 1000, unchangedCount: 0, failureCount: 0, rand: () => 1 })).toBe(1100);
  });
});

describe('disableReason', () => {
  it('disables gone and chronically failing sources', () => {
    expect(disableReason({ failureCount: 3, permanentFailures: 3, maxFailures: 12 })).toBe('gone');
    expect(disableReason({ failureCount: 12, permanentFailures: 0, maxFailures: 12 })).toBe('too_many_failures');
    expect(disableReason({ failureCount: 2, permanentFailures: 2, maxFailures: 12 })).toBeNull();
  });
});

const job = (o: Partial<NormalizedJob> = {}): NormalizedJob => ({
  platform: 'gem', companySlug: 'acme', externalId: '1', title: 'Engineer', descriptionHtml: '<p>a</p>', locations: ['Berlin', 'Remote'], remote: null,
  department: null, employmentType: null, seniority: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryText: null,
  postedAt: '2026-11-01T00:00:00.000Z', applyUrl: 'https://x/1', raw: {}, ...o,
});

describe('hashes', () => {
  it('snapshotHash ignores order, detects content changes', () => {
    const a = job(), b = job({ externalId: '2', title: 'PM' });
    expect(snapshotHash([a, b])).toBe(snapshotHash([b, a]));
    expect(snapshotHash([a, b])).not.toBe(snapshotHash([a]));
    expect(snapshotHash([a])).not.toBe(snapshotHash([job({ descriptionHtml: '<p>changed</p>' })]));
    expect(snapshotHash([])).toBe(snapshotHash([]));
  });
  it('dedupeKey collapses case/whitespace/location order but not different cities', () => {
    expect(dedupeKey(job({ title: '  Engineer ', locations: ['remote', 'BERLIN'] }))).toBe(dedupeKey(job()));
    expect(dedupeKey(job({ locations: ['Paris'] }))).not.toBe(dedupeKey(job()));
    expect(dedupeKey(job({ companySlug: 'other' }))).not.toBe(dedupeKey(job()));
  });
});

describe('politeFetch host spacing under concurrency', () => {
  it('spaces simultaneous requests to the same host', async () => {
    const times: number[] = [];
    vi.stubGlobal('fetch', async () => { times.push(Date.now()); return new Response('{}', { status: 200 }); });
    await Promise.all([1, 2, 3].map(() => politeFetch('https://spacing.test/x', { minIntervalMs: 80, retries: 0 })));
    vi.unstubAllGlobals();
    times.sort((a, b) => a - b);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(70);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(70);
  });
});
