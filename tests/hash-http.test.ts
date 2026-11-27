import { describe, expect, it, vi } from 'vitest';
import { dedupeKey } from '../src/hash.js';
import { politeFetch } from '../src/http.js';
import { normalized } from './helpers/records.js';

describe('dedupeKey', () => {
  const job = (o = {}) => normalized('1', { title: 'Engineer', locations: ['Berlin', 'Remote'], ...o });
  it('collapses case/whitespace/location order but not different cities or companies', () => {
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
