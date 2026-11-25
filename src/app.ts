import Fastify, { type FastifyServerOptions } from 'fastify';
import type { QueryResult, QueryResultRow } from 'pg';
import { DETAIL_SQL, QueryError, buildJobsQuery, isJobId, parseJobsQuery, toPage } from './query.js';
import { openapiSpec } from './openapi.js';

/** The slice of pg.Pool the API needs; lets tests inject their own pool. */
export interface Db {
  query<R extends QueryResultRow = any>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

export function buildApp(db: Db, opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);

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

  return app;
}
