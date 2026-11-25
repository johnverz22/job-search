import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { buildJobsQuery, parseJobsQuery } from '../src/query.js';

/**
 * DB-backed API tests. They TRUNCATE the jobs and sources tables, so they only run when TEST_DATABASE_URL is set
 * (never DATABASE_URL), and they refuse to run against a database whose name doesn't contain "test".
 *   TEST_DATABASE_URL=postgres://jobsearch:jobsearch@localhost:5432/jobsearch_test npm test
 */
const URL = process.env.TEST_DATABASE_URL;

type Json = Record<string, any>;

// On CI a missing TEST_DATABASE_URL must fail the build rather than silently skip the DB suite and report green.
it.runIf(!URL && !!process.env.CI)('CI must provide TEST_DATABASE_URL (DB-backed API tests cannot be skipped on CI)', () => {
  throw new Error('TEST_DATABASE_URL is not set but CI=true; refusing to pass without running the DB-backed tests');
});

describe.skipIf(!URL)('API against real Postgres', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  const id: Record<string, string> = {}; // seed name -> job id

  const get = async (url: string): Promise<{ status: number; body: Json }> => {
    const res = await app.inject({ method: 'GET', url });
    return { status: res.statusCode, body: res.json() };
  };
  const titles = (b: Json) => (b.jobs as Json[]).map((j) => j.title as string);
  const ids = (b: Json) => (b.jobs as Json[]).map((j) => j.id as string);

  /** Follow next_cursor to the end; returns every page. Guards against runaway loops. */
  async function walk(url: string): Promise<Json[]> {
    const pages: Json[] = [];
    let next: string | null = null;
    do {
      const { status, body } = await get(next ? `${url}${url.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(next)}` : url);
      expect(status, JSON.stringify(body)).toBe(200);
      pages.push(body);
      next = body.next_cursor;
      expect(pages.length).toBeLessThan(200);
    } while (next);
    return pages;
  }

  async function insert(name: string, j: Partial<Record<string, unknown>> & { title: string }) {
    const row = {
      platform: 'gem', company_slug: 'acme', description_html: null, locations: [] as string[], remote: null, department: null,
      employment_type: null, seniority: null, salary_min: null, salary_max: null, salary_currency: null, salary_text: null,
      posted_at: null, apply_url: null, status: 'open', dedupe_key: name, first_seen: '2026-11-01T00:00:00Z', ...j,
    } as Record<string, any>;
    const { rows } = await pool.query(
      `INSERT INTO jobs (key, platform, company_slug, external_id, title, description_html, locations, remote, department, employment_type,
         seniority, salary_min, salary_max, salary_currency, salary_text, posted_at, apply_url, raw, status, dedupe_key, first_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'{}',$18,$19,$20) RETURNING id`,
      [`${row.platform}:${row.company_slug}:${name}`, row.platform, row.company_slug, name, row.title, row.description_html, row.locations,
       row.remote, row.department, row.employment_type, row.seniority, row.salary_min, row.salary_max, row.salary_currency, row.salary_text,
       row.posted_at, row.apply_url, row.status, row.dedupe_key, row.first_seen],
    );
    id[name] = rows[0].id;
    return rows[0].id as string;
  }

  beforeAll(async () => {
    const dbName = new globalThis.URL(URL!).pathname.slice(1);
    if (!/test/i.test(dbName)) throw new Error(`Refusing to run: TEST_DATABASE_URL database "${dbName}" must contain "test" (these tests TRUNCATE tables)`);
    pool = new pg.Pool({ connectionString: URL });
    await migrate(undefined, pool, false);
    await pool.query('TRUNCATE jobs, sources RESTART IDENTITY');
    app = buildApp(pool, { logger: false });

    await insert('react-dev', {
      title: 'Senior React Developer', platform: 'gem', company_slug: 'acme', department: 'Engineering', locations: ['Berlin, Germany'],
      remote: true, employment_type: 'Full-time', seniority: 'Senior', salary_min: 90000, salary_max: 120000, salary_currency: 'EUR',
      posted_at: '2026-11-20T09:00:00Z', description_html: '<p>Build UIs with React and TypeScript.</p>',
    });
    await insert('frontend', {
      title: 'Frontend Engineer', platform: 'recruitee', company_slug: 'acme', department: 'Engineering', locations: ['Paris, France'],
      remote: false, employment_type: 'Full-time', seniority: 'Mid', salary_min: 60000, salary_max: 80000, salary_currency: 'EUR',
      posted_at: '2026-11-18T09:00:00Z', description_html: '<div class="python">We use React daily</div>',
    });
    await insert('python', {
      title: 'Python Backend Developer', platform: 'personio', company_slug: 'globex', locations: ['Munich'], remote: null,
      posted_at: '2026-11-15T09:00:00Z', description_html: '<p>Django and Postgres. You will be developing APIs.</p>',
    });
    await insert('designer', {
      title: 'Product Designer', platform: 'gem', company_slug: 'globex-corp', department: 'Design', locations: ['Remote - EU'], remote: true,
      salary_min: 50000, salary_currency: 'EUR', posted_at: null, first_seen: '2026-11-10T00:00:00Z',
    });
    await insert('sales', {
      title: 'Account Executive', platform: 'teamtailor', company_slug: 'initech', department: 'Sales & Marketing',
      locations: ['New York, NY'], remote: false, employment_type: 'part_time', salary_min: 70000, salary_max: 90000, salary_currency: 'USD',
      posted_at: '2026-11-05T09:00:00Z', description_html: '<p>Drive revenue &amp; growth</p>',
    });
    await insert('closed-react', { title: 'React Architect', status: 'closed', posted_at: '2026-11-19T09:00:00Z' });
    await insert('dup-old', { title: 'Data Analyst', dedupe_key: 'dup-1', posted_at: '2026-11-12T09:00:00Z', company_slug: 'dupco' });
    await insert('dup-new', { title: 'Data Analyst', dedupe_key: 'dup-1', posted_at: '2026-11-13T09:00:00Z', company_slug: 'dupco', platform: 'recruitee' });
    // Legacy rows written before dedupe_key existed: distinct=true must not collapse them into one.
    await insert('legacy-a', { title: 'Support Agent', dedupe_key: null, company_slug: 'legacy-a', posted_at: '2026-11-02T09:00:00Z' });
    await insert('legacy-b', { title: 'Support Agent', dedupe_key: null, company_slug: 'legacy-b', posted_at: '2026-11-03T09:00:00Z' });
    await insert('percent', { title: 'Ops Lead', company_slug: 'pct', department: '100% Remote Ops', locations: ['Bogotá'], posted_at: '2026-11-04T09:00:00Z' });
    // 1.4 MB description: must not break the INSERT (tsvector size limit); only the first 100k chars are indexed.
    await insert('huge', {
      title: 'Growth Marketer', company_slug: 'huge', posted_at: '2026-11-06T09:00:00Z',
      description_html: `<p>quokka ${'lorem ipsum '.repeat(100_000)} zebrafinal</p>`,
    });
    // Pagination stressors: identical timestamps, microsecond-apart timestamps, and equal-relevance rows.
    for (let n = 1; n <= 6; n++) await insert(`tie-${n}`, { title: 'Tie Engineer', company_slug: 'tiebreak', posted_at: '2026-10-01T12:00:00Z' });
    for (let n = 1; n <= 4; n++) await insert(`micro-${n}`, { title: 'Micro Engineer', company_slug: 'tiebreak', posted_at: `2026-10-02 00:00:00.00000${n}+00` });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  describe('full-text search', () => {
    it('finds matches in title and description, ranking a title match above a description-only match', async () => {
      const { status, body } = await get('/jobs?q=react');
      expect(status).toBe(200);
      expect(titles(body)).toEqual(['Senior React Developer', 'Frontend Engineer']);
      expect(body.jobs[0].relevance).toBeGreaterThan(body.jobs[1].relevance);
    });

    it('never returns closed jobs', async () => {
      expect(titles((await get('/jobs?q=architect')).body)).toEqual([]);
    });

    it('stems words (developing finds developer)', async () => {
      expect(titles((await get('/jobs?q=developing')).body).sort()).toEqual(['Python Backend Developer', 'Senior React Developer']);
    });

    it('supports phrases, exclusion and or', async () => {
      expect(titles((await get('/jobs?q=' + encodeURIComponent('"react developer"'))).body)).toEqual(['Senior React Developer']);
      expect(titles((await get('/jobs?q=' + encodeURIComponent('developer -react'))).body)).toEqual(['Python Backend Developer']);
      expect(titles((await get('/jobs?q=' + encodeURIComponent('python or designer'))).body).sort()).toEqual(['Product Designer', 'Python Backend Developer']);
    });

    it('does not index HTML tags or entities, only the visible text', async () => {
      // frontend's description contains <div class="python">; "python" must only match the real Python job.
      expect(titles((await get('/jobs?q=python')).body)).toEqual(['Python Backend Developer']);
      expect((await get('/jobs?q=div')).body.jobs).toEqual([]);
      expect((await get('/jobs?q=amp')).body.jobs).toEqual([]);
      expect(titles((await get('/jobs?q=revenue')).body)).toEqual(['Account Executive']);
    });

    it('matches on department and company slug', async () => {
      expect(titles((await get('/jobs?q=sales')).body)).toEqual(['Account Executive']);
      expect(titles((await get('/jobs?q=globex')).body).sort()).toEqual(['Product Designer', 'Python Backend Developer']);
    });

    it('survives hostile and malformed search input without erroring', async () => {
      for (const q of ['"unclosed', '(((', '&|!:*', "'; DROP TABLE jobs; --", '-', 'or', '\\', 'a'.repeat(200)]) {
        const res = await get('/jobs?q=' + encodeURIComponent(q));
        expect(res.status, q).toBe(200);
      }
      expect(Number((await pool.query('SELECT count(*) FROM jobs')).rows[0].count)).toBeGreaterThan(10);
    });

    it('returns an empty page (not an error) for stop-word-only queries', async () => {
      const res = await get('/jobs?q=the');
      expect(res.status).toBe(200);
      expect(res.body.jobs).toEqual([]);
    });

    it('inserts a 1.4 MB description without error and indexes its beginning only', async () => {
      expect(titles((await get('/jobs?q=quokka')).body)).toEqual(['Growth Marketer']);
      expect((await get('/jobs?q=zebrafinal')).body.jobs).toEqual([]);
    });

    it('keeps the index current when a job is updated (the crawler upsert path)', async () => {
      const marker = await insert('mutable', { title: 'Old Title', company_slug: 'mut', posted_at: '2026-11-07T09:00:00Z' });
      expect(titles((await get('/jobs?q=zyxwv')).body)).toEqual([]);
      await pool.query(`UPDATE jobs SET title = 'Zyxwv Specialist' WHERE id = $1`, [marker]);
      expect(titles((await get('/jobs?q=zyxwv')).body)).toEqual(['Zyxwv Specialist']);
      await pool.query(`DELETE FROM jobs WHERE id = $1`, [marker]);
    });

    it('sorts by newest when asked, even with q', async () => {
      const { body } = await get('/jobs?q=react&sort=newest');
      expect(titles(body)).toEqual(['Senior React Developer', 'Frontend Engineer']); // 11-20 then 11-18
      // "engineer" is in the frontend job's title but only in the react job's department ("Engineering"): relevance and newest disagree
      expect(titles((await get('/jobs?q=engineer&company=acme')).body)).toEqual(['Frontend Engineer', 'Senior React Developer']);
      expect(titles((await get('/jobs?q=engineer&company=acme&sort=newest')).body)).toEqual(['Senior React Developer', 'Frontend Engineer']);
    });
  });

  describe('filters', () => {
    it('platform and company, single and multiple', async () => {
      expect(titles((await get('/jobs?platform=recruitee&company=acme')).body)).toEqual(['Frontend Engineer']);
      expect(titles((await get('/jobs?platform=gem,personio&company=acme,globex')).body).sort()).toEqual(['Python Backend Developer', 'Senior React Developer']);
      expect(titles((await get('/jobs?platform=teamtailor&platform=personio&sort=newest')).body)).toEqual(['Python Backend Developer', 'Account Executive']);
    });

    it('department and location are case-insensitive substrings', async () => {
      expect(titles((await get('/jobs?department=ENGINEER')).body).sort()).toEqual(['Frontend Engineer', 'Senior React Developer']);
      expect(titles((await get('/jobs?location=berlin')).body)).toEqual(['Senior React Developer']);
      expect(titles((await get('/jobs?location=' + encodeURIComponent('new york'))).body)).toEqual(['Account Executive']);
      expect(titles((await get('/jobs?location=' + encodeURIComponent('Bogotá'))).body)).toEqual(['Ops Lead']);
    });

    it('treats % and _ in user input literally, not as wildcards', async () => {
      expect((await get('/jobs?department=' + encodeURIComponent('%'))).body.jobs.map((j: Json) => j.title)).toEqual(['Ops Lead']);
      expect((await get('/jobs?department=' + encodeURIComponent('100%'))).body.jobs).toHaveLength(1);
      expect((await get('/jobs?department=' + encodeURIComponent('1_0'))).body.jobs).toEqual([]);
      expect((await get('/jobs?location=' + encodeURIComponent('B_rlin'))).body.jobs).toEqual([]);
    });

    it('remote true / false are exact and unknown (null) matches neither', async () => {
      const remoteTrue = titles((await get('/jobs?remote=true&company=acme,globex,globex-corp,initech,pct')).body).sort();
      expect(remoteTrue).toEqual(['Product Designer', 'Senior React Developer']);
      const remoteFalse = titles((await get('/jobs?remote=false&company=acme,globex,globex-corp,initech,pct')).body).sort();
      expect(remoteFalse).toEqual(['Account Executive', 'Frontend Engineer']);
      expect(ids((await get('/jobs?remote=false&limit=200')).body)).not.toContain(id['python']);
      expect(ids((await get('/jobs?remote=true&limit=200')).body)).not.toContain(id['python']);
    });

    it('employment_type is case-insensitive exact', async () => {
      expect(titles((await get('/jobs?employment_type=FULL-TIME&sort=newest')).body)).toEqual(['Senior React Developer', 'Frontend Engineer']);
      expect(titles((await get('/jobs?employment_type=part_time')).body)).toEqual(['Account Executive']);
      expect((await get('/jobs?employment_type=full')).body.jobs).toEqual([]);
      expect(titles((await get('/jobs?seniority=senior')).body)).toEqual(['Senior React Developer']);
    });

    it('salary range filters use range overlap and require a matching currency', async () => {
      // react-dev 90-120k EUR, frontend 60-80k EUR, designer >=50k EUR (min only), sales 70-90k USD
      expect(titles((await get('/jobs?min_salary=100000&salary_currency=eur')).body)).toEqual(['Senior React Developer']);
      expect(titles((await get('/jobs?min_salary=85000&salary_currency=EUR&sort=newest')).body)).toEqual(['Senior React Developer']);
      expect(titles((await get('/jobs?max_salary=55000&salary_currency=EUR')).body)).toEqual(['Product Designer']);
      // overlap with [75k, 85k]: frontend (60-80k) overlaps; react-dev (90-120k) starts above it; designer (50k+, no max) tops out below it
      expect(titles((await get('/jobs?min_salary=75000&max_salary=85000&salary_currency=EUR&sort=newest')).body)).toEqual(['Frontend Engineer']);
      expect(titles((await get('/jobs?min_salary=70000&salary_currency=USD')).body)).toEqual(['Account Executive']);
      // jobs with no salary never match a salary bound
      expect(ids((await get('/jobs?min_salary=1&salary_currency=EUR&limit=200')).body)).not.toContain(id['python']);
      expect((await get('/jobs?min_salary=1000')).status).toBe(400);
    });

    it('has_salary', async () => {
      expect((await get('/jobs?has_salary=true&limit=200')).body.jobs).toHaveLength(4);
      const without = ids((await get('/jobs?has_salary=false&limit=200')).body);
      expect(without).toContain(id['python']);
      expect(without).not.toContain(id['react-dev']);
    });

    it('posted_after and posted_within_days fall back to first_seen when posted_at is null', async () => {
      expect(titles((await get('/jobs?posted_after=2026-11-14&sort=newest&company=acme,globex,globex-corp,initech')).body))
        .toEqual(['Senior React Developer', 'Frontend Engineer', 'Python Backend Developer']);
      // designer has no posted_at; first_seen 2026-11-10 counts
      expect(ids((await get('/jobs?posted_after=2026-11-09T00:00:00Z&limit=200')).body)).toContain(id['designer']);
      expect(ids((await get('/jobs?posted_after=2026-11-11&limit=200')).body)).not.toContain(id['designer']);
      // compare against Postgres directly so the assertion doesn't depend on the wall clock
      const recent = await pool.query(`SELECT count(*)::int AS n FROM jobs WHERE status='open' AND sort_ts >= now() - interval '30 days'`);
      expect((await get('/jobs?posted_within_days=30&limit=200')).body.jobs).toHaveLength(recent.rows[0].n);
    });

    it('distinct collapses duplicates to the newest and never collapses rows with a null dedupe_key', async () => {
      const dupes = (await get('/jobs?company=dupco')).body;
      expect(dupes.jobs).toHaveLength(2);
      const distinct = (await get('/jobs?company=dupco&distinct=true')).body;
      expect(ids(distinct)).toEqual([id['dup-new']]);
      const legacy = (await get('/jobs?company=legacy-a,legacy-b&distinct=true')).body;
      expect(legacy.jobs).toHaveLength(2);
    });

    it('distinct keeps the best-ranked duplicate under relevance sort', async () => {
      const { body } = await get('/jobs?q=analyst&company=dupco&distinct=true');
      expect(body.jobs).toHaveLength(1);
    });

    it('rejects bad input with a 400 and a message', async () => {
      for (const [url, msg] of [
        ['/jobs?limit=0', /limit/], ['/jobs?remote=maybe', /remote/], ['/jobs?platform=nope', /platform/], ['/jobs?bogus=1', /unknown parameter/],
        ['/jobs?sort=relevance', /requires q/], ['/jobs?cursor=garbage', /invalid cursor/], ['/jobs?offset=1&cursor=x', /combined/],
      ] as const) {
        const res = await get(url);
        expect(res.status, url).toBe(400);
        expect(res.body.error).toBe('invalid_query');
        expect(res.body.message).toMatch(msg);
      }
    });
  });

  describe('cursor pagination', () => {
    /** Independent oracle: ask Postgres directly for the full ordering. */
    const oracle = async (sql: string) => (await pool.query(sql)).rows.map((r) => String(r.id));

    it('walks every open job exactly once in newest order, across identical and microsecond-apart timestamps', async () => {
      const expected = await oracle(`SELECT id FROM jobs WHERE status='open' ORDER BY sort_ts DESC, id DESC`);
      for (const limit of [1, 2, 3, 7, 200]) {
        const pages = await walk(`/jobs?limit=${limit}`);
        const got = pages.flatMap(ids);
        expect(got, `limit=${limit}`).toEqual(expected);
        expect(new Set(got).size).toBe(got.length);
        for (const p of pages.slice(0, -1)) expect(p.jobs).toHaveLength(limit);
        expect(pages.at(-1)!.next_cursor).toBeNull();
      }
    });

    it('keeps microsecond-apart rows distinct and ordered (cursor carries full-precision timestamps)', async () => {
      const got = (await walk('/jobs?company=tiebreak&limit=1&posted_after=2026-10-02')).flatMap(ids);
      expect(got).toEqual([id['micro-4'], id['micro-3'], id['micro-2'], id['micro-1']]);
    });

    it('breaks ties on identical timestamps by id, with no gaps or repeats', async () => {
      const got = (await walk('/jobs?company=tiebreak&limit=4&posted_after=2026-09-30&sort=newest')).flatMap(ids);
      expect(got).toHaveLength(10);
      const ties = got.filter((x) => ['tie-1', 'tie-2', 'tie-3', 'tie-4', 'tie-5', 'tie-6'].some((n) => id[n] === x));
      expect(ties).toEqual(['tie-6', 'tie-5', 'tie-4', 'tie-3', 'tie-2', 'tie-1'].map((n) => id[n]));
    });

    it('walks a relevance-sorted search with equal-relevance rows exactly once', async () => {
      const expected = await oracle(`SELECT id FROM jobs WHERE status='open' AND search_tsv @@ websearch_to_tsquery('english','engineer')
        ORDER BY ts_rank_cd(search_tsv, websearch_to_tsquery('english','engineer'), 1)::float8 DESC, sort_ts DESC, id DESC`);
      expect(expected.length).toBeGreaterThanOrEqual(11);
      for (const limit of [1, 2, 5]) {
        const pages = await walk(`/jobs?q=engineer&limit=${limit}`);
        const got = pages.flatMap(ids);
        expect(got, `limit=${limit}`).toEqual(expected);
        const rel = pages.flatMap((p) => p.jobs.map((j: Json) => j.relevance as number));
        expect([...rel].sort((a, b) => b - a)).toEqual(rel);
      }
    });

    it('paginates distinct results without duplicating or dropping a group', async () => {
      const expected = await oracle(`SELECT id FROM (SELECT DISTINCT ON (coalesce(dedupe_key, key)) id, sort_ts FROM jobs WHERE status='open'
        ORDER BY coalesce(dedupe_key, key), sort_ts DESC, id DESC) t ORDER BY sort_ts DESC, id DESC`);
      for (const limit of [1, 3]) expect((await walk(`/jobs?distinct=true&limit=${limit}`)).flatMap(ids)).toEqual(expected);
    });

    it('walks with filters applied', async () => {
      const got = (await walk('/jobs?platform=gem&remote=true&limit=1&sort=newest')).flatMap(titles);
      expect(got).toEqual(['Senior React Developer', 'Product Designer']);
    });

    it('rejects a cursor used with different filters or a different sort', async () => {
      const first = (await get('/jobs?q=engineer&limit=1')).body;
      expect(first.next_cursor).toBeTruthy();
      expect((await get(`/jobs?q=engineer&limit=1&cursor=${first.next_cursor}`)).status).toBe(200);
      expect((await get(`/jobs?q=engineer&limit=1&remote=true&cursor=${first.next_cursor}`)).body.message).toMatch(/different filters/);
      expect((await get(`/jobs?q=engineer&limit=1&sort=newest&cursor=${first.next_cursor}`)).body.message).toMatch(/different sort/);
    });

    it('still supports deprecated offset paging', async () => {
      const all = ids((await get('/jobs?limit=200')).body);
      const page = (await get('/jobs?limit=3&offset=2')).body;
      expect(ids(page)).toEqual(all.slice(2, 5));
      expect(page.offset).toBe(2);
      expect(page.next_cursor).toBeTruthy();
    });

    it('reports an empty final page cleanly', async () => {
      const { body } = await get('/jobs?company=does-not-exist');
      expect(body).toMatchObject({ count: 0, next_cursor: null, jobs: [] });
    });
  });

  describe('GET /jobs/:id', () => {
    it('returns the full job including the description', async () => {
      const { status, body } = await get(`/jobs/${id['react-dev']}`);
      expect(status).toBe(200);
      expect(body).toMatchObject({ id: id['react-dev'], title: 'Senior React Developer', status: 'open', external_id: 'react-dev', salary_currency: 'EUR' });
      expect(body.description_html).toContain('React and TypeScript');
      expect(body).not.toHaveProperty('raw');
      expect(body).not.toHaveProperty('search_tsv');
      expect(body).not.toHaveProperty('sort_ts');
    });

    it('returns closed jobs too, flagged by status', async () => {
      expect((await get(`/jobs/${id['closed-react']}`)).body.status).toBe('closed');
    });

    it('404s for a missing id and 400s for malformed ids', async () => {
      expect((await get('/jobs/999999999')).status).toBe(404);
      expect((await get('/jobs/999999999')).body.error).toBe('not_found');
      for (const bad of ['abc', '1e3', '-1', '1.5', '9223372036854775807', '0x10', `1%20OR%201=1`]) {
        const res = await get(`/jobs/${bad}`);
        expect(res.status, bad).toBe(400);
      }
    });
  });

  describe('docs and ops endpoints', () => {
    it('serves the OpenAPI document', async () => {
      const { status, body } = await get('/openapi.json');
      expect(status).toBe(200);
      expect(body.openapi).toMatch(/^3\./);
      expect(Object.keys(body.paths)).toEqual(expect.arrayContaining(['/jobs', '/jobs/{id}', '/stats', '/health']));
    });

    it('health and stats still work', async () => {
      expect((await get('/health')).body).toEqual({ ok: true });
      const stats = (await get('/stats')).body;
      expect(stats.jobs.find((j: Json) => j.platform === 'gem')).toMatchObject({ open: expect.any(Number), closed: 1 });
    });
  });

  describe('query plans', () => {
    /**
     * On a ~30-row table every plan costs about the same, so "the planner happened to pick the index" proves nothing here;
     * real-size behaviour was measured separately (see docs/planning/05-api.md). What these tests can prove is *eligibility*:
     * with the competing paths switched off, the plan names our index only if the predicate/ordering can actually use it.
     */
    async function explain(sql: string, values: unknown[], settings: string[]) {
      const client = await pool.connect();
      try {
        for (const s of settings) await client.query(`SET ${s} = off`);
        const { rows } = await client.query(`EXPLAIN ${sql}`, values);
        return rows.map((r) => r['QUERY PLAN']).join('\n');
      } finally {
        await client.query('RESET ALL');
        client.release();
      }
    }

    it('the search_tsv GIN index is usable for the @@ predicate we generate', async () => {
      // GIN only supports bitmap scans, so with seq and plain index scans off this names jobs_search_idx or nothing.
      const plan = await explain(`SELECT id FROM jobs WHERE search_tsv @@ websearch_to_tsquery('english', $1)`, ['react'], ['enable_seqscan', 'enable_indexscan']);
      expect(plan).toContain('Bitmap Index Scan on jobs_search_idx');
    });

    it('newest-first keyset paging can use the sort index, with and without a cursor', async () => {
      const first = buildJobsQuery(parseJobsQuery({}));
      expect(await explain(first.text, first.values, ['enable_seqscan'])).toContain('jobs_open_sort_idx');
      const cursor = (await get('/jobs?limit=1')).body.next_cursor;
      const next = buildJobsQuery(parseJobsQuery({ cursor }));
      expect(await explain(next.text, next.values, ['enable_seqscan'])).toContain('jobs_open_sort_idx');
    });
  });
});
