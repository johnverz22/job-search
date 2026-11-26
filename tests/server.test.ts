import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServer, CSP } from '../src/app.js';
import { cachedFacets, FACETS_SQL, loadFacets } from '../src/facets.js';

/** A fake Db that answers by SQL text; enough to exercise routing without Postgres. */
const fakeDb = (rows: Record<string, unknown>[] = []) => ({
  calls: [] as string[],
  async query(text: string) {
    this.calls.push(text);
    return { rows: text.includes('facet') ? rows : [{ '?column?': 1 }] } as any;
  },
});

function webRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>spa</title>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  return dir;
}

describe('buildServer', () => {
  const app = buildServer(fakeDb(), { webRoot: webRoot() });

  it('serves the SPA shell at / and for client-side routes, never cached', async () => {
    for (const url of ['/', '/jobs/123', '/status', '/jobs/123?x=1']) {
      const r = await app.inject(url);
      expect(r.statusCode, url).toBe(200);
      expect(r.body, url).toContain('<title>spa</title>');
    }
    expect((await app.inject('/')).headers['cache-control']).toBe('no-cache');
  });

  it('caches fingerprinted assets forever', async () => {
    const r = await app.inject('/assets/app-abc123.js');
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toContain('immutable');
  });

  it('real 404s: unknown API paths, missing assets and non-GET requests do not get the SPA shell', async () => {
    for (const [method, url] of [['GET', '/api/nope'], ['GET', '/assets/missing.js'], ['GET', '/favicon.ico'], ['POST', '/status']] as const) {
      const r = await app.inject({ method, url });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
      expect(r.body, `${method} ${url}`).not.toContain('spa');
    }
  });

  it('mounts the API under /api, keeps /health at the root, and the bare paths are the SPA, not JSON', async () => {
    expect((await app.inject('/health')).json()).toEqual({ ok: true });
    expect((await app.inject('/api/health')).json()).toEqual({ ok: true });
    expect((await app.inject('/api/jobs?sort=relevance')).statusCode).toBe(400); // parsed by the API (relevance needs q)
    expect((await app.inject('/api/openapi.json')).json().openapi).toMatch(/^3\./);
  });

  it('sets security headers on every response, including errors', async () => {
    for (const url of ['/', '/api/jobs?bogus=1', '/api/nope', '/assets/app-abc123.js']) {
      const h = (await app.inject(url)).headers;
      expect(h['content-security-policy'], url).toBe(CSP);
      expect(h['x-content-type-options'], url).toBe('nosniff');
      expect(h['x-frame-options'], url).toBe('DENY');
      expect(h['referrer-policy'], url).toBe('no-referrer');
    }
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).not.toContain('unsafe-eval');
    expect(CSP).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('works API-only when the web root is missing', async () => {
    const apiOnly = buildServer(fakeDb(), { webRoot: join(tmpdir(), 'does-not-exist') });
    expect((await apiOnly.inject('/api/health')).statusCode).toBe(200);
    expect((await apiOnly.inject('/')).statusCode).toBe(404);
  });
});

describe('facets', () => {
  const rows = [
    { facet: 'platform', value: 'gem', count: 5 }, { facet: 'platform', value: 'workday', count: '3' },
    { facet: 'location', value: 'Berlin', count: 2 }, { facet: 'salary_currency', value: 'EUR', count: 1 },
  ];
  it('groups rows by facet with numeric counts and always returns every facet key', async () => {
    const f = await loadFacets(fakeDb(rows));
    expect(f.platform).toEqual([{ value: 'gem', count: 5 }, { value: 'workday', count: 3 }]);
    expect(f.location).toEqual([{ value: 'Berlin', count: 2 }]);
    expect(f.seniority).toEqual([]);
    expect(Object.keys(f).sort()).toEqual(['department', 'employment_type', 'location', 'platform', 'salary_currency', 'seniority']);
  });
  it('caches for the TTL, then refreshes; concurrent callers share one query', async () => {
    const db = fakeDb(rows);
    let t = 0;
    const get = cachedFacets(db, 1000, () => t);
    await Promise.all([get(), get(), get()]);
    expect(db.calls).toHaveLength(1);
    t = 999; await get();
    expect(db.calls).toHaveLength(1);
    t = 1001; await get();
    expect(db.calls).toHaveLength(2);
  });
  it('/api/facets responds with Cache-Control', async () => {
    const r = await buildServer(fakeDb(rows)).inject('/api/facets');
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=300');
  });
  it('limits and orders in SQL', () => {
    expect(FACETS_SQL).toContain('rn <= 50');
    expect(FACETS_SQL).toContain("status='open'");
  });
});
