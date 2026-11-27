import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { cachedFacets } from './facets.js';
import { isJobId, type Aggregator, type SourceState } from './model.js';
import { openapiSpec } from './openapi.js';
import { QueryError, parseJobsQuery } from './query.js';
import { searchJobs, toDetailRow, toPage } from './search.js';

/** GET /api/stats. `closed` is always 0: a job is either listed or gone. */
export function computeStats(agg: Aggregator, now = Date.now()) {
  const jobs = new Map<string, number>();
  for (const r of agg.all()) jobs.set(r.platform, (jobs.get(r.platform) ?? 0) + 1);
  const states = agg.states();
  const sources = new Map<string, { platform: string; state: SourceState['status']; n: number }>();
  for (const s of states) {
    const key = `${s.platform}/${s.status}`;
    const row = sources.get(key) ?? { platform: s.platform, state: s.status, n: 0 };
    row.n++;
    sources.set(key, row);
  }
  const due = states.map((s) => Date.parse(s.nextDueAt)).filter((t) => t <= now);
  const byName = <T>(f: (x: T) => string) => (a: T, b: T) => f(a).localeCompare(f(b));
  return {
    jobs: [...jobs].map(([platform, open]) => ({ platform, open, closed: 0 })).sort(byName((x) => x.platform)),
    sources: [...sources.values()].sort(byName((x) => `${x.platform}/${x.state}`)),
    queue: { due: due.length, oldest_due: due.length ? new Date(Math.min(...due)).toISOString() : null },
    crawl: agg.progress(),
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
}

/** The JSON API as an encapsulated plugin, so it can be mounted bare (tests) or under /api (the server). */
function apiRoutes(agg: Aggregator) {
  return async (app: FastifyInstance) => {
    const facets = cachedFacets(agg);

    app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
      if (err instanceof QueryError) return reply.code(400).send({ error: 'invalid_query', message: err.message });
      if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'bad_request', message: err.message });
      app.log.error(err);
      return reply.code(500).send({ error: 'internal_error' });
    });

    app.get('/health', async () => ({ ok: true }));

    app.get('/openapi.json', async () => openapiSpec);

    app.get('/facets', async (_req, reply) => {
      // While the first crawl is running the values change quickly, so do not let browsers hold on to them.
      reply.header('Cache-Control', agg.progress().ready ? 'public, max-age=300' : 'no-store');
      return facets();
    });

    app.get('/jobs', async (req) => {
      const query = parseJobsQuery(req.query as Record<string, unknown>);
      return toPage(query, searchJobs(agg.all(), query));
    });

    app.get('/jobs/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!isJobId(id)) return reply.code(400).send({ error: 'invalid_id', message: 'id must be 12 hexadecimal characters' });
      const record = agg.get(id);
      if (!record) return reply.code(404).send({ error: 'not_found', message: `no job with id ${id}` });
      return toDetailRow(record);
    });

    app.get('/stats', async () => computeStats(agg));
  };
}

/** API only, unprefixed. Used by tests. */
export function buildApp(agg: Aggregator, opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);
  app.register(apiRoutes(agg));
  return app;
}

// Scripts are locked to our own files. Inline *styles* are allowed because Radix's scroll lock (react-remove-scroll) injects a
// <style> element at runtime; blocking it would let the page scroll behind an open dialog. Style injection cannot run code.
export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
  "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export interface ServerOptions {
  /** Directory with the built web app (index.html + assets). Omit or point at a missing dir to serve the API only. */
  webRoot?: string;
  fastify?: FastifyServerOptions;
}

/**
 * Production server: the JSON API under /api, the built SPA at / (same origin, so no CORS), an index.html fallback for
 * client-side routes, security headers on everything. /health also stays at the root for container health checks.
 */
export function buildServer(agg: Aggregator, opts: ServerOptions = {}) {
  const app = Fastify(opts.fastify ?? {});
  app.addHook('onSend', async (_req, reply) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
  });
  app.register(apiRoutes(agg), { prefix: '/api' });
  // Healthy as soon as the process listens, even while the first crawl is still running.
  app.get('/health', async () => ({ ok: true }));

  const root = opts.webRoot;
  if (root && existsSync(join(root, 'index.html'))) {
    // Required lazily so API-only deploys (e.g. serverless, where it is never registered) do not load it.
    const fastifyStatic = createRequire(import.meta.url)('@fastify/static') as typeof import('@fastify/static').default;
    app.register(fastifyStatic, {
      root, wildcard: false, index: ['index.html'],
      // Vite fingerprints everything under /assets, so it can be cached forever; index.html must always revalidate.
      setHeaders: (reply, path) => void reply.header('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'),
    });
    // Unknown GETs that look like pages get the SPA shell; unknown API paths and asset-like paths stay real 404s.
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split('?')[0];
      if (req.method === 'GET' && !path.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(path)) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found' });
    });
  }
  return app;
}
