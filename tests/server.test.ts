import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp, buildServer, CSP } from '../src/app.js';
import type { SourceState } from '../src/model.js';
import { openapiSpec } from '../src/openapi.js';
import { JOB_PARAMS } from '../src/query.js';
import { fakeAggregator, record } from './helpers/records.js';

const react = record('react', { title: 'Senior React Developer', descriptionHtml: '<p>React</p>', salaryMin: 5, salaryMax: 9, salaryCurrency: 'EUR', locations: ['Berlin'] });
const other = record('other', { title: 'Designer', platform: 'workday' });

const state = (o: Partial<SourceState>): SourceState => ({
  platform: 'gem', slug: 'acme', status: 'ok', jobs: 1, lastAttemptAt: null, lastOkAt: null, lastError: null, failures: 0,
  nextDueAt: '2999-01-01T00:00:00.000Z', ...o,
});

const agg = () => fakeAggregator([react, other], {
  states: [
    state({}), state({ slug: 'b' }), state({ slug: 'c', status: 'failing', nextDueAt: '2020-01-02T00:00:00.000Z' }),
    state({ platform: 'workday', status: 'pending', nextDueAt: '2020-01-01T00:00:00.000Z' }),
  ],
  progress: { ready: false, total: 4, done: 3 },
});

describe('API routes', () => {
  const app = buildApp(agg());
  const get = async (url: string) => {
    const r = await app.inject(url);
    return { status: r.statusCode, body: r.json(), headers: r.headers };
  };

  it('lists jobs in the documented shape', async () => {
    const { status, body } = await get('/jobs?q=react');
    expect(status).toBe(200);
    expect(body).toMatchObject({ count: 1, limit: 50, next_cursor: null });
    expect(Object.keys(body.jobs[0]).sort()).toEqual([
      'apply_url', 'company_slug', 'dedupe_key', 'department', 'employment_type', 'first_seen', 'id', 'last_seen', 'locations', 'platform',
      'posted_at', 'relevance', 'remote', 'salary_currency', 'salary_max', 'salary_min', 'salary_text', 'seniority', 'title',
    ]);
    expect(body.jobs[0]).toMatchObject({ id: react.id, salary_min: '5', salary_max: '9' });
  });

  it('serves one job, 404 for unknown ids and 400 for malformed ones', async () => {
    expect((await get(`/jobs/${react.id}`)).body).toMatchObject({ id: react.id, status: 'open', external_id: 'react', description_html: '<p>React</p>' });
    expect(await get('/jobs/000000000000')).toMatchObject({ status: 404, body: { error: 'not_found' } });
    for (const bad of ['1', 'abc', 'ABCDEF012345', `${react.id}0`, '1%20OR%201=1']) {
      expect(await get(`/jobs/${bad}`), bad).toMatchObject({ status: 400, body: { error: 'invalid_id' } });
    }
  });

  it('rejects bad queries and cursors with a message', async () => {
    for (const [url, message] of [
      ['/jobs?limit=0', /limit/], ['/jobs?bogus=1', /unknown parameter/], ['/jobs?sort=relevance', /requires q/],
      ['/jobs?cursor=garbage', /invalid cursor/], ['/jobs?offset=1&cursor=x', /combined/],
    ] as const) {
      const r = await get(url);
      expect(r.status, url).toBe(400);
      expect(r.body.error).toBe('invalid_query');
      expect(r.body.message).toMatch(message);
    }
    const cursor = (await get('/jobs?limit=1')).body.next_cursor;
    expect((await get(`/jobs?limit=1&cursor=${cursor}`)).status).toBe(200);
    expect((await get(`/jobs?limit=1&remote=true&cursor=${cursor}`)).body.message).toMatch(/different filters/);
  });

  it('reports stats, crawl progress and memory', async () => {
    const { body } = await get('/stats');
    expect(body.jobs).toEqual([{ platform: 'gem', open: 1, closed: 0 }, { platform: 'workday', open: 1, closed: 0 }]);
    expect(body.sources).toEqual([{ platform: 'gem', state: 'failing', n: 1 }, { platform: 'gem', state: 'ok', n: 2 }, { platform: 'workday', state: 'pending', n: 1 }]);
    expect(body.queue).toEqual({ due: 2, oldest_due: '2020-01-01T00:00:00.000Z' });
    expect(body.crawl).toEqual({ ready: false, total: 4, done: 3 });
    expect(body.memory_mb).toBeGreaterThan(0);
    expect((await buildApp(fakeAggregator()).inject('/stats')).json().queue).toEqual({ due: 0, oldest_due: null });
  });

  it('serves facets, cacheable only once the first crawl is done', async () => {
    const pending = await get('/facets');
    expect(pending.body.location).toEqual([{ value: 'Berlin', count: 1 }]);
    expect(pending.headers['cache-control']).toBe('no-store');
    expect((await buildApp(fakeAggregator()).inject('/facets')).headers['cache-control']).toBe('public, max-age=300');
  });

  it('reflects newly published data', async () => {
    const live = fakeAggregator();
    const server = buildApp(live);
    expect((await server.inject('/jobs')).json().count).toBe(0);
    expect((await server.inject('/facets')).json().platform).toEqual([]);
    live.set([react]);
    expect((await server.inject('/jobs')).json().count).toBe(1);
    expect((await server.inject('/facets')).json().platform).toEqual([{ value: 'gem', count: 1 }]);
  });

  it('documents exactly the parameters the parser accepts', async () => {
    const { body } = await get('/openapi.json');
    expect(body.openapi).toMatch(/^3\./);
    expect(openapiSpec.paths['/jobs'].get.parameters.map((p) => p.name).sort()).toEqual(Object.keys(JOB_PARAMS).sort());
    expect(Object.keys(body.paths)).toEqual(expect.arrayContaining(['/jobs', '/jobs/{id}', '/stats', '/health', '/facets']));
  });
});

function webRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>spa</title>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  return dir;
}

describe('buildServer', () => {
  const app = buildServer(agg(), { webRoot: webRoot() });

  it('serves the SPA shell at / and for client-side routes, never cached', async () => {
    for (const url of ['/', `/jobs/${react.id}`, '/status', '/jobs/123?x=1']) {
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

  it('mounts the API under /api and keeps /health at the root, healthy while still crawling', async () => {
    expect((await app.inject('/health')).json()).toEqual({ ok: true });
    expect((await app.inject('/api/health')).json()).toEqual({ ok: true });
    expect((await app.inject('/api/jobs?sort=relevance')).statusCode).toBe(400);
    expect((await app.inject('/api/jobs')).json().count).toBe(2);
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
    expect(CSP).not.toMatch(/script-src[^;]*unsafe-inline/); // code execution stays locked down
    expect(CSP).toContain("style-src 'self' 'unsafe-inline'"); // needed by the dialog scroll lock
  });

  it('works API-only when the web root is missing', async () => {
    const apiOnly = buildServer(agg(), { webRoot: join(tmpdir(), 'does-not-exist') });
    expect((await apiOnly.inject('/api/health')).statusCode).toBe(200);
    expect((await apiOnly.inject('/')).statusCode).toBe(404);
  });
});
