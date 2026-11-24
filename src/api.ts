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
  const { rows } = await pool.query(
    `SELECT id, platform, company_slug, title, locations, remote, department, employment_type, seniority,
            salary_min, salary_max, salary_currency, salary_text, posted_at, apply_url, first_seen, last_seen
     FROM jobs WHERE ${where.join(' AND ')} ORDER BY posted_at DESC NULLS LAST, id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { count: rows.length, limit, offset, jobs: rows };
});

app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8080) }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
