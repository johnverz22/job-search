import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffMs, createAggregator, optionsFromEnv, type AggregatorOptions } from '../src/aggregator.js';
import { HttpError } from '../src/http.js';
import type { SourceEntry } from '../src/model.js';
import { readSnapshot, writeSnapshot } from '../src/snapshot.js';
import { PLATFORMS, type Connector, type FetchContext, type NormalizedJob, type Platform } from '../src/types.js';
import { normalized, record } from './helpers/records.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

type Behaviour = (ctx: FetchContext | undefined) => NormalizedJob[] | Promise<NormalizedJob[]>;

/** One fake connector per platform, dispatching on the slug. */
function fakes(behaviours: Record<string, Behaviour>, caching: Platform[] = []) {
  const calls: { slug: string; at: number; ctx?: FetchContext }[] = [];
  const connectors = Object.fromEntries(PLATFORMS.map((platform): [Platform, Connector] => [platform, {
    platform,
    cachesDetail: caching.includes(platform),
    async fetchJobs(slug, ctx) {
      calls.push({ slug, at: Date.now(), ctx });
      return behaviours[slug](ctx);
    },
  }])) as Record<Platform, Connector>;
  return { connectors, calls };
}

const entry = (slug: string, platform: Platform = 'gem'): SourceEntry => ({ platform, slug });
const jobs = (slug: string, ...ids: string[]) => ids.map((id) => normalized(id, { companySlug: slug }));
const make = (entries: SourceEntry[], connectors: Record<Platform, Connector>, o: AggregatorOptions = {}) =>
  createAggregator(entries, { connectors, refreshMs: HOUR, random: () => 0.5, log: () => {}, ...o });
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => { vi.useFakeTimers({ now: new Date('2026-11-27T00:00:00Z') }); });
afterEach(() => { vi.useRealTimers(); });

describe('crawl loop', () => {
  it('publishes each source as soon as it finishes', async () => {
    let release!: (j: NormalizedJob[]) => void;
    const { connectors } = fakes({ fast: () => jobs('fast', '1'), slow: () => new Promise((r) => { release = r; }) });
    const agg = make([entry('fast'), entry('slow')], connectors);
    agg.start();
    await tick();
    expect(agg.all()).toHaveLength(1);
    expect(agg.progress()).toEqual({ ready: false, total: 2, done: 1 });
    const before = agg.all();
    const v = agg.version();
    release(jobs('slow', '2'));
    await tick();
    expect(agg.all()).toHaveLength(2);
    expect(before).toHaveLength(1); // the old array was replaced, not mutated
    expect(agg.version()).toBeGreaterThan(v);
    expect(agg.progress()).toEqual({ ready: true, total: 2, done: 2 });
    expect(agg.get(agg.all()[0].id)).toBe(agg.all()[0]);
    await agg.stop();
  });

  it('replaces a source on success, keeping firstSeen and dropping removed jobs', async () => {
    let list = jobs('a', '1', '2');
    const { connectors } = fakes({ a: () => list });
    const agg = make([entry('a')], connectors);
    agg.start();
    await tick();
    const first = agg.all().find((r) => r.externalId === '1')!;
    list = jobs('a', '1', '3');
    await tick(HOUR);
    expect(agg.all().map((r) => r.externalId).sort()).toEqual(['1', '3']);
    const again = agg.get(first.id)!;
    expect(again.firstSeen).toBe(first.firstSeen);
    expect(Date.parse(again.lastSeen)).toBeGreaterThan(Date.parse(first.lastSeen));
    await agg.stop();
  });

  it('backs off a failing source, caps at 6h, and keeps its jobs until they are stale', async () => {
    let fail = false;
    const { connectors, calls } = fakes({ a: () => { if (fail) throw new Error('boom'); return jobs('a', '1'); } });
    const agg = make([entry('a')], connectors, { staleMs: 24 * HOUR });
    agg.start();
    await tick();
    fail = true;
    const start = Date.now();
    await tick(HOUR);
    expect(agg.states()[0]).toMatchObject({ status: 'failing', failures: 1, lastError: 'boom', jobs: 1 });
    await tick(20 * HOUR);
    expect(agg.all()).toHaveLength(1);
    const gaps = calls.slice(1).map((c) => (c.at - start) / HOUR);
    expect(gaps.slice(0, 5)).toEqual([1, 3, 7, 13, 19]); // +2h, +4h, then capped at 6h
    await tick(12 * HOUR);
    expect(agg.all()).toHaveLength(0);
    expect(agg.states()[0].jobs).toBe(0);
    fail = false;
    await tick(6 * HOUR);
    expect(agg.states()[0]).toMatchObject({ status: 'ok', failures: 0, lastError: null });
    await agg.stop();
  });

  it('does not overflow the timer on a very long refresh interval', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const { connectors } = fakes({ a: () => jobs('a', '1') });
    const agg = make([entry('a')], connectors, { refreshMs: 100_000 * MIN });
    agg.start();
    await tick();
    expect(Math.max(...spy.mock.calls.map((c) => Number(c[1] ?? 0)))).toBe(2 ** 31 - 1);
    spy.mockRestore();
    await agg.stop();
  });

  it('computes backoff', () => {
    expect(backoffMs(HOUR, 1)).toBe(2 * HOUR);
    expect(backoffMs(HOUR, 10)).toBe(6 * HOUR);
    expect(backoffMs(12 * HOUR, 3)).toBe(12 * HOUR); // never more eager than the normal interval
  });

  it('marks permanent HTTP errors invalid and retries daily', async () => {
    const { connectors, calls } = fakes({ gone: () => { throw new HttpError(404, 'u'); }, flaky: () => { throw new HttpError(503, 'u'); } });
    const agg = make([entry('gone'), entry('flaky')], connectors);
    agg.start();
    await tick();
    expect(agg.states().map((s) => s.status)).toEqual(['invalid', 'failing']);
    expect(agg.progress().ready).toBe(true);
    await tick(23 * HOUR);
    expect(calls.filter((c) => c.slug === 'gone')).toHaveLength(1);
    await tick(HOUR);
    expect(calls.filter((c) => c.slug === 'gone')).toHaveLength(2);
    await agg.stop();
  });

  it('gives connectors the previous detail, and drops raw for the others', async () => {
    const { connectors, calls } = fakes({
      cached: () => [normalized('1', { companySlug: 'cached', platform: 'workday', raw: { detail: 'd' }, detailFetchedAt: '2026-11-26T00:00:00Z' })],
      plain: () => [normalized('1', { companySlug: 'plain', raw: { big: true } })],
    }, ['workday']);
    const agg = make([entry('cached', 'workday'), entry('plain')], connectors);
    agg.start();
    await tick();
    expect(agg.all().find((r) => r.companySlug === 'plain')!.raw).toBeNull();
    await tick(HOUR);
    const second = calls.filter((c) => c.slug === 'cached')[1];
    expect(second.ctx?.previous?.get('1')).toEqual({ raw: { detail: 'd' }, detailFetchedAt: '2026-11-26T00:00:00Z' });
    expect(calls.filter((c) => c.slug === 'plain')[1].ctx?.previous).toBeUndefined();
    await agg.stop();
  });

  it('respects the concurrency limit and reaches ready with a consistent index over 30 mixed sources', async () => {
    let running = 0;
    let peak = 0;
    const behaviours: Record<string, Behaviour> = {};
    for (let i = 0; i < 30; i++) {
      behaviours[`s${i}`] = async () => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 100 + (i % 7) * 50));
        running--;
        if (i % 5 === 1) throw new Error('flaky');
        if (i % 5 === 2) throw new HttpError(410, 'u');
        return i % 5 === 3 ? [] : jobs(`s${i}`, '1', '2', '2'); // duplicate ids from a connector collapse
      };
    }
    const { connectors } = fakes(behaviours);
    const agg = make(Object.keys(behaviours).map((s) => entry(s)), connectors, { concurrency: 3 });
    agg.start();
    await tick(10_000);
    expect(peak).toBe(3);
    expect(agg.progress()).toEqual({ ready: true, total: 30, done: 30 });
    expect(agg.all()).toHaveLength(agg.states().reduce((n, s) => n + s.jobs, 0));
    expect(agg.all()).toHaveLength(24);
    expect(new Set(agg.all().map((r) => r.id)).size).toBe(24);
    await agg.stop();
  });

  it('stop() waits for crawls in progress and schedules nothing more', async () => {
    const { connectors, calls } = fakes({ a: () => new Promise((r) => setTimeout(() => r(jobs('a', '1')), 500)) });
    const agg = make([entry('a')], connectors);
    agg.start();
    await tick();
    const stopped = agg.stop();
    await tick(500);
    await stopped;
    expect(agg.all()).toHaveLength(1);
    await tick(48 * HOUR);
    expect(calls).toHaveLength(1);
  });

  it('stop() gives up on a hung crawl and ignores its late result', async () => {
    let release!: (j: NormalizedJob[]) => void;
    const { connectors } = fakes({ a: () => new Promise((r) => { release = r; }) });
    const agg = make([entry('a')], connectors, { stopTimeoutMs: 1000 });
    agg.start();
    await tick();
    const stopped = agg.stop();
    await tick(1000);
    await stopped;
    release(jobs('a', '1'));
    await tick();
    expect(agg.all()).toHaveLength(0);
  });

  it('is ready immediately with no sources', () => {
    expect(make([], fakes({}).connectors).progress()).toEqual({ ready: true, total: 0, done: 0 });
  });

  it('reads configuration from the environment', () => {
    expect(optionsFromEnv({})).toEqual({ concurrency: 4, refreshMs: HOUR, staleMs: 72 * HOUR, snapshotFile: undefined });
    expect(optionsFromEnv({ CRAWL_CONCURRENCY: '2', REFRESH_MINUTES: '5', STALE_HOURS: 'junk', SNAPSHOT_FILE: '/x' }))
      .toEqual({ concurrency: 2, refreshMs: 5 * MIN, staleMs: 72 * HOUR, snapshotFile: '/x' });
  });
});

describe('snapshot', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'snap-')), 'jobs.ndjson.gz');
  beforeEach(() => { vi.useRealTimers(); });

  const until = async (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true));
  const quick = (path: string, behaviours: Record<string, Behaviour>, log: (m: string) => void = () => {}) =>
    make([entry('a')], fakes(behaviours).connectors, { snapshotFile: path, log });

  it('round trips records, including derived fields', async () => {
    const path = file();
    const original = record('1', { title: 'Dev Ops', descriptionHtml: '<p>héllo</p>', salaryMin: 5, raw: { x: 1 }, postedAt: '2026-11-01T00:00:00Z' });
    await writeSnapshot(path, [{ platform: 'gem', slug: 'acme', lastOkAt: '2026-11-02T00:00:00Z', records: [original] }]);
    expect(await readSnapshot(path)).toEqual([{ platform: 'gem', slug: 'acme', lastOkAt: '2026-11-02T00:00:00Z', records: [original] }]);
    expect(await readSnapshot(`${path}.missing`)).toBeNull();
  });

  it('is written on stop and restored on the next boot, then refreshed with firstSeen intact', async () => {
    const path = file();
    const one = quick(path, { a: () => jobs('a', '1') });
    one.start();
    await until(() => one.all().length === 1);
    await one.stop();
    expect(existsSync(path)).toBe(true);
    const firstSeen = one.all()[0].firstSeen;

    let release!: (j: NormalizedJob[]) => void;
    const two = quick(path, { a: () => new Promise((r) => { release = r; }) });
    two.start();
    await until(() => two.all().length === 1 && release !== undefined); // served from disk while the crawl is still running
    expect(two.progress().ready).toBe(false);
    release(jobs('a', '1', '2'));
    await until(() => two.all().length === 2);
    expect(two.all().find((r) => r.externalId === '1')!.firstSeen).toBe(firstSeen);
    await two.stop();
  });

  it('ignores a corrupt or truncated file with a warning', async () => {
    for (const content of [Buffer.from('not gzip'), gzipSync('{"type":"snapshot","version":1}\n'), gzipSync('{nope\n')]) {
      const path = file();
      writeFileSync(path, content);
      const messages: string[] = [];
      const agg = quick(path, { a: () => jobs('a', '1') }, (m) => messages.push(m));
      agg.start();
      await until(() => agg.progress().ready);
      expect(messages.some((m) => m.startsWith('snapshot: ignoring'))).toBe(true);
      expect(agg.all()).toHaveLength(1);
      await agg.stop();
      expect(readFileSync(path)).not.toEqual(content);
    }
  });
});
