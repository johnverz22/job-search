import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { QueryResult, QueryResultRow } from 'pg';
import { DETAIL_SQL, QueryError, buildJobsQuery, isJobId, parseJobsQuery, toPage } from './query.js';
import { openapiSpec } from './openapi.js';
import { cachedFacets } from './facets.js';

/** The slice of pg.Pool the API needs; lets tests inject their own pool. */
export interface Db {
  query<R extends QueryResultRow = any>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

/** The JSON API as an encapsulated plugin, so it can be mounted bare (tests) or under /api (the server). */
function apiRoutes(db: Db) {
  return async (app: FastifyInstance) => {
  const facets = cachedFacets(db);

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof QueryError) return reply.code(400).send({ error: 'invalid_query', message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'bad_request', message: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  app.get('/openapi.json', async () => openapiSpec);

  app.get('/facets', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return facets();
  });

  app.get('/jobs', async (req) => {
    const query = parseJobsQuery(req.query as Record<string, unknown>);
    const built = buildJobsQuery(query);
    const { rows } = await db.query(built.text, built.values);
    return toPage(query, rows);
  });

  app.get('/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!isJobId(id)) return reply.code(400).send({ error: 'invalid_id', message: 'id must be a positive integer' });
    const { rows } = await db.query(DETAIL_SQL, [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'not_found', message: `no job with id ${id}` });
    return rows[0];
  });

  app.get('/stats', async () => {
    const [jobs, sources, due] = await Promise.all([
      db.query(`SELECT platform, count(*) FILTER (WHERE status='open')::int AS open, count(*) FILTER (WHERE status='closed')::int AS closed FROM jobs GROUP BY 1 ORDER BY 1`),
      db.query(`SELECT platform, CASE WHEN enabled THEN 'active' ELSE coalesce(disabled_reason, validation_status) END AS state, count(*)::int AS n
                FROM sources GROUP BY 1,2 ORDER BY 1,2`),
      db.query(`SELECT count(*)::int AS due, min(next_run_at) AS oldest_due FROM sources WHERE enabled AND next_run_at <= now()`),
    ]);
    return { jobs: jobs.rows, sources: sources.rows, queue: due.rows[0] };
  });
  };
}

/** API only, unprefixed. Used by tests. */
export function buildApp(db: Db, opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);
  app.register(apiRoutes(db));
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
export function buildServer(db: Db, opts: ServerOptions = {}) {
  const app = Fastify(opts.fastify ?? {});
  app.addHook('onSend', async (_req, reply) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
  });
  app.register(apiRoutes(db), { prefix: '/api' });
  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  const root = opts.webRoot;
  if (root && existsSync(join(root, 'index.html'))) {
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
