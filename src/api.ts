import Fastify from 'fastify';
import { pool } from './db.js';

const app = Fastify({ logger: true });

app.get('/health', async () => {
  await pool.query('SELECT 1');
  return { ok: true };
});

app.get('/jobs', async (req) => {
  const q = req.query as Record<string, string | undefined>;
  const where: string[] = [`status = 'open'`];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (q.q) add(`(title ILIKE ? OR description_html ILIKE ?)`, `%${q.q}%`);
  if (q.platform) add('platform = ?', q.platform);
  if (q.company) add('company_slug = ?', q.company);
  if (q.department) add('department ILIKE ?', `%${q.department}%`);
  if (q.remote === 'true') where.push('remote IS TRUE');
  const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
  const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
  const cols = `id, platform, company_slug, title, locations, remote, department, employment_type, seniority,
            salary_min, salary_max, salary_currency, salary_text, posted_at, apply_url, first_seen, last_seen, dedupe_key`;
  const order = `posted_at DESC NULLS LAST, id DESC`;
  const sql = q.distinct === 'true'
    ? `SELECT * FROM (SELECT DISTINCT ON (dedupe_key) ${cols} FROM jobs WHERE ${where.join(' AND ')} ORDER BY dedupe_key, ${order}) t
       ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`
    : `SELECT ${cols} FROM jobs WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
  const { rows } = await pool.query(sql, params);
  return { count: rows.length, limit, offset, jobs: rows };
});

app.get('/stats', async () => {
  const [jobs, sources, due] = await Promise.all([
    pool.query(`SELECT platform, count(*) FILTER (WHERE status='open')::int AS open, count(*) FILTER (WHERE status='closed')::int AS closed FROM jobs GROUP BY 1 ORDER BY 1`),
    pool.query(`SELECT platform, CASE WHEN enabled THEN 'active' ELSE coalesce(disabled_reason, validation_status) END AS state, count(*)::int AS n
                FROM sources GROUP BY 1,2 ORDER BY 1,2`),
    pool.query(`SELECT count(*)::int AS due, min(next_run_at) AS oldest_due FROM sources WHERE enabled AND next_run_at <= now()`),
  ]);
  return { jobs: jobs.rows, sources: sources.rows, queue: due.rows[0] };
});

app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8080) }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
