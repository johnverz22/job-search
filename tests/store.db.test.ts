import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrate } from '../src/migrate.js';
import { loadPrevious, saveSnapshot } from '../src/store.js';
import type { NormalizedJob } from '../src/types.js';

/** DB-backed store tests; same guard as api.db.test.ts (TEST_DATABASE_URL only, database name must contain "test"). */
const URL = process.env.TEST_DATABASE_URL;
const SLUG = 'store-test';

const job = (id: string, extra: Partial<NormalizedJob> = {}): NormalizedJob => ({
  platform: 'bamboohr', companySlug: SLUG, externalId: id, title: `Job ${id}`, descriptionHtml: null, locations: [], remote: null, department: null,
  employmentType: null, seniority: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryText: null, postedAt: null, applyUrl: null,
  raw: { list: { id }, detail: null }, ...extra,
});

describe.skipIf(!URL)('store: detail cache persistence (real Postgres)', () => {
  let db: pg.Pool;
  beforeAll(async () => {
    const dbName = new globalThis.URL(URL!).pathname.slice(1);
    if (!/test/i.test(dbName)) throw new Error(`Refusing to run: database "${dbName}" must contain "test"`);
    db = new pg.Pool({ connectionString: URL });
    await migrate(undefined, db, false);
    await db.query('DELETE FROM jobs WHERE company_slug = $1', [SLUG]);
  });
  afterAll(async () => {
    await db.query('DELETE FROM jobs WHERE company_slug = $1', [SLUG]);
    await db.end();
  });

  it('persists detail_fetched_at and raw, and loadPrevious hands them back keyed by external id', async () => {
    const fetchedAt = '2026-11-20T10:00:00.000Z';
    await saveSnapshot('bamboohr', SLUG, [
      job('1', { raw: { list: { id: 1 }, detail: { description: '<p>d</p>' } }, detailFetchedAt: fetchedAt }),
      job('2'), // detail never fetched
    ], db);
    const prev = await loadPrevious('bamboohr', SLUG, db);
    expect([...prev.keys()].sort()).toEqual(['1', '2']);
    expect(prev.get('1')).toEqual({ raw: { list: { id: 1 }, detail: { description: '<p>d</p>' } }, detailFetchedAt: fetchedAt });
    expect(prev.get('2')!.detailFetchedAt).toBeNull();
  });

  it('a later snapshot updates the timestamp, and closed jobs stay loadable (a reopened job can reuse its detail)', async () => {
    const t2 = '2026-11-26T08:00:00.000Z';
    await saveSnapshot('bamboohr', SLUG, [job('1', { raw: { list: { id: 1 }, detail: { description: '<p>new</p>' } }, detailFetchedAt: t2 })], db); // job 2 disappears -> closed
    const { rows } = await db.query(`SELECT external_id, status FROM jobs WHERE company_slug=$1 ORDER BY external_id`, [SLUG]);
    expect(rows).toEqual([{ external_id: '1', status: 'open' }, { external_id: '2', status: 'closed' }]);
    const prev = await loadPrevious('bamboohr', SLUG, db);
    expect(prev.get('1')!.detailFetchedAt).toBe(t2);
    expect(prev.has('2')).toBe(true);
  });

  it('does not leak across sources', async () => {
    expect((await loadPrevious('bamboohr', 'someone-else', db)).size).toBe(0);
    expect((await loadPrevious('jazzhr', SLUG, db)).size).toBe(0);
  });
});
