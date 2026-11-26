// Seeds a deterministic dataset into the TEST database and serves the built SPA + API on one port, for Playwright.
// Prerequisites: `npm run build` in the repo root and in web/. Needs TEST_DATABASE_URL (database name must contain "test").
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildServer } from '../../dist/app.js';
import { migrate } from '../../dist/migrate.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required');
const dbName = new URL(url).pathname.slice(1);
if (!/test/i.test(dbName)) throw new Error(`Refusing to run: database "${dbName}" must contain "test" (it is truncated)`);
const webRoot = fileURLToPath(new URL('../dist', import.meta.url));
if (!existsSync(`${webRoot}/index.html`)) throw new Error('web/dist is missing: run `npm run build` in web/ first');

const pool = new pg.Pool({ connectionString: url });
await migrate(fileURLToPath(new URL('../../migrations', import.meta.url)), pool, false);
await pool.query('TRUNCATE jobs, sources RESTART IDENTITY');

async function job(name, j) {
  const r = { platform: 'gem', company_slug: 'acme-inc', description_html: null, locations: [], remote: null, department: null, employment_type: null, seniority: null,
    salary_min: null, salary_max: null, salary_currency: null, salary_text: null, posted_at: null, apply_url: `https://apply.example/${name}`, status: 'open', dedupe_key: name, ...j };
  await pool.query(
    `INSERT INTO jobs (key, platform, company_slug, external_id, title, description_html, locations, remote, department, employment_type, seniority,
       salary_min, salary_max, salary_currency, salary_text, posted_at, apply_url, raw, status, dedupe_key, first_seen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'{}',$18,$19,now())`,
    [`${r.platform}:${r.company_slug}:${name}`, r.platform, r.company_slug, name, r.title, r.description_html, r.locations, r.remote, r.department, r.employment_type, r.seniority,
      r.salary_min, r.salary_max, r.salary_currency, r.salary_text, r.posted_at, r.apply_url, r.status, r.dedupe_key],
  );
}

const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
await job('react', { title: 'Senior React Developer', department: 'Engineering', locations: ['Berlin, Germany', 'Remote - EU'], remote: true, employment_type: 'Full time', seniority: 'Senior',
  salary_min: 70000, salary_max: 95000, salary_currency: 'EUR', posted_at: day(2),
  description_html: '<h2>About the role</h2><p>Build <strong>great</strong> products.</p><ul><li>React</li><li>TypeScript</li></ul><script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 1"><a href="javascript:window.__pwned=1">sneaky</a>' });
await job('closed', { title: 'Retired Architect', status: 'closed', description_html: '<p>Gone.</p>' });
await job('nodesc', { title: 'Mystery Role', platform: 'workday', company_slug: 'globex.wd5/External', description_html: null, locations: [] });
for (let i = 1; i <= 120; i++) {
  await job(`support-${i}`, { title: `Support Engineer ${i}`, platform: i % 3 ? 'recruitee' : 'gem', company_slug: `company-${i % 7}`, locations: [i % 2 ? 'Manila, Philippines' : 'Austin, TX'], remote: i % 4 === 0 ? true : i % 4 === 1 ? false : null,
    department: 'Support', employment_type: i % 2 ? 'Full time' : 'Contract', posted_at: day(i % 40), description_html: `<p>Help customers (${i}).</p>` });
}
for (const [platform, slug, state] of [['gem', 'acme-inc', 'valid'], ['recruitee', 'company-1', 'valid'], ['workday', 'globex.wd5/External', 'invalid']]) {
  await pool.query(`INSERT INTO sources (platform, company_slug, enabled, validation_status) VALUES ($1,$2,$3,$4)`, [platform, slug, state === 'valid', state]);
}

const app = buildServer(pool, { webRoot });
const port = Number(process.env.PORT ?? 4173);
await app.listen({ port, host: '127.0.0.1' });
console.log(`e2e server ready on http://127.0.0.1:${port}`);
