import { describe, expect, it } from 'vitest';
import {
  JOB_PARAMS, MAX_LIMIT, QueryError, buildJobsQuery, decodeCursor, encodeCursor, escapeLike, filterFingerprint,
  parseJobsQuery, toPage, type CursorPayload,
} from '../src/query.js';
import { openapiSpec } from '../src/openapi.js';

const parse = (raw: Record<string, unknown> = {}) => parseJobsQuery(raw);
const rejects = (raw: Record<string, unknown>, msg: RegExp) => {
  expect(() => parse(raw)).toThrow(QueryError);
  expect(() => parse(raw)).toThrow(msg);
};

/** Every $n placeholder in the SQL must have a bound value, and every value must be used. */
function expectConsistentPlaceholders(text: string, values: unknown[]) {
  const used = new Set([...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  expect(Math.max(...used)).toBe(values.length);
  for (let i = 1; i <= values.length; i++) expect(used.has(i), `$${i} unused`).toBe(true);
}

describe('parseJobsQuery', () => {
  it('applies defaults: newest sort, limit 50, no distinct', () => {
    expect(parse()).toMatchObject({ sort: 'newest', limit: 50, distinct: false });
  });

  it('defaults to relevance sort when q is present, and trims q', () => {
    expect(parse({ q: '  react developer ' })).toMatchObject({ q: 'react developer', sort: 'relevance' });
    expect(parse({ q: 'react', sort: 'newest' }).sort).toBe('newest');
  });

  it('treats blank values as absent', () => {
    expect(parse({ q: '   ', department: '', platform: ',' })).toMatchObject({ q: undefined, department: undefined, platform: undefined });
  });

  it('rejects sort=relevance without q, bad sort, and unknown parameters', () => {
    rejects({ sort: 'relevance' }, /requires q/);
    rejects({ sort: 'oldest' }, /sort must be one of/);
    rejects({ qq: 'x', foo: '1' }, /unknown parameter\(s\): qq, foo/);
  });

  it('validates limit and offset strictly instead of silently defaulting', () => {
    expect(parse({ limit: '200' }).limit).toBe(MAX_LIMIT);
    rejects({ limit: '0' }, /limit must be an integer/);
    rejects({ limit: '201' }, /limit must be an integer/);
    rejects({ limit: 'abc' }, /limit must be an integer/);
    rejects({ limit: '-5' }, /limit must be an integer/);
    rejects({ offset: '10001' }, /offset must be an integer/);
    expect(parse({ offset: '20' }).offset).toBe(20);
  });

  it('rejects over-long q and repeated scalar parameters', () => {
    rejects({ q: 'x'.repeat(201) }, /at most 200/);
    rejects({ department: ['a', 'b'] }, /more than once/);
  });

  it('accepts list parameters repeated or comma-separated, de-duplicated', () => {
    expect(parse({ platform: ['gem', 'recruitee,gem'], company: 'a, b' })).toMatchObject({ platform: ['gem', 'recruitee'], company: ['a', 'b'] });
    rejects({ platform: 'greenhouse' }, /unknown platform: greenhouse/);
    rejects({ company: Array.from({ length: 21 }, (_, i) => `c${i}`).join(',') }, /at most 20/);
  });

  it('parses booleans strictly', () => {
    expect(parse({ remote: 'true', has_salary: 'false', distinct: 'true' })).toMatchObject({ remote: true, hasSalary: false, distinct: true });
    rejects({ remote: 'yes' }, /remote must be "true" or "false"/);
  });

  it('requires a currency for salary bounds and keeps min <= max', () => {
    rejects({ min_salary: '50000' }, /require salary_currency/);
    rejects({ max_salary: '50000' }, /require salary_currency/);
    rejects({ min_salary: '9', max_salary: '8', salary_currency: 'usd' }, /must not exceed/);
    rejects({ min_salary: '-1', salary_currency: 'USD' }, /non-negative number/);
    rejects({ salary_currency: 'dollars' }, /3-letter/);
    expect(parse({ min_salary: '50000.5', salary_currency: 'eur' })).toMatchObject({ minSalary: 50000.5, salaryCurrency: 'EUR' });
  });

  it('parses posted_after to an ISO instant and rejects junk', () => {
    expect(parse({ posted_after: '2026-11-01' }).postedAfter).toBe('2026-11-01T00:00:00.000Z');
    rejects({ posted_after: 'yesterday' }, /ISO date/);
    rejects({ posted_after: '2026-13-45' }, /ISO date/);
    rejects({ posted_within_days: '0' }, /posted_within_days/);
    rejects({ posted_within_days: '366' }, /posted_within_days/);
  });

  it('refuses offset together with cursor', () => {
    rejects({ offset: '5', cursor: 'abc' }, /cannot be combined/);
  });
});

describe('cursors', () => {
  const base: CursorPayload = { v: 1, s: 'newest', f: filterFingerprint(parse()), t: '2026-11-01 00:00:00.123456+00', i: '42' };

  it('round-trips, preserving microsecond timestamps', () => {
    expect(decodeCursor(encodeCursor(base))).toEqual(base);
    const rel = { ...base, s: 'relevance' as const, r: 0.0607927 };
    expect(decodeCursor(encodeCursor(rel))).toEqual(rel);
  });

  it('rejects malformed cursors rather than passing them to SQL', () => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    for (const bad of [
      'not-base64-json', enc(null), enc([]), enc({ ...base, v: 2 }), enc({ ...base, s: 'oldest' }),
      enc({ ...base, t: "2026-01-01'; DROP TABLE jobs;--" }), enc({ ...base, i: '1; DROP' }), enc({ ...base, i: 42 }),
      enc({ ...base, s: 'relevance' }), // relevance cursor must carry a rank
      enc({ ...base, r: 1 }), // newest cursor must not
      enc({ ...base, s: 'relevance', r: 'high' }),
    ]) {
      expect(() => decodeCursor(bad), String(bad)).toThrow(/invalid cursor/);
    }
  });

  it('rejects a cursor replayed with a different sort or different filters', () => {
    const q = parse({ q: 'react', remote: 'true' });
    const cur = encodeCursor({ v: 1, s: 'relevance', f: filterFingerprint(q), t: '2026-11-01 00:00:00+00', r: 0.5, i: '7' });
    expect(parse({ q: 'react', remote: 'true', cursor: cur }).cursor?.i).toBe('7');
    rejects({ q: 'react', remote: 'true', sort: 'newest', cursor: cur }, /different sort/);
    rejects({ q: 'react', remote: 'false', cursor: cur }, /different filters/);
    rejects({ q: 'vue', remote: 'true', cursor: cur }, /different filters/);
  });

  it('fingerprint ignores paging parameters', () => {
    expect(filterFingerprint(parse({ q: 'a', limit: '10' }))).toBe(filterFingerprint(parse({ q: 'a', limit: '100', offset: '40' })));
  });
});

describe('buildJobsQuery', () => {
  it('builds a plain newest-first query with only the open filter', () => {
    const { text, values } = buildJobsQuery(parse());
    expect(text).toContain(`status = 'open'`);
    expect(text).toContain('ORDER BY sort_ts DESC, id DESC LIMIT $1');
    expect(text).not.toContain('search_tsv');
    expect(values).toEqual([51]);
  });

  it('uses websearch_to_tsquery + ts_rank_cd and binds the query text once', () => {
    const { text, values } = buildJobsQuery(parse({ q: 'senior react' }));
    expect(text).toContain(`search_tsv @@ websearch_to_tsquery('english', $1)`);
    expect(text).toContain('ORDER BY _rel DESC, sort_ts DESC, id DESC');
    expect(values[0]).toBe('senior react');
    expectConsistentPlaceholders(text, values);
  });

  it('never interpolates user input into SQL text', () => {
    const evil = `'; DROP TABLE jobs; --`;
    const { text, values } = buildJobsQuery(parse({ q: evil, department: evil, location: evil, company: evil, employment_type: evil }));
    expect(text).not.toContain('DROP');
    expect(values.flat().join('|')).toContain(evil);
    expectConsistentPlaceholders(text, values);
  });

  it('escapes LIKE wildcards in department and location', () => {
    expect(escapeLike('100%_x\\')).toBe('100\\%\\_x\\\\');
    const { values } = buildJobsQuery(parse({ department: '50%', location: 'a_b' }));
    expect(values).toContain('%50\\%%');
    expect(values).toContain('%a\\_b%');
  });

  it('adds each filter and keeps placeholders consistent with every filter at once', () => {
    const q = parse({
      q: 'engineer', platform: 'gem,recruitee', company: 'acme', department: 'eng', location: 'berlin', employment_type: 'Full-Time',
      seniority: 'Senior', remote: 'true', min_salary: '1', max_salary: '9', salary_currency: 'usd', has_salary: 'true',
      posted_after: '2026-01-01', posted_within_days: '30', distinct: 'true', limit: '10', offset: '5',
    });
    const { text, values } = buildJobsQuery(q);
    expect(text).toContain('DISTINCT ON (coalesce(dedupe_key, key))');
    expect(text).toContain('OFFSET');
    expect(text).toContain('remote IS TRUE');
    expect(values).toContainEqual(['full-time']); // employment type lowercased for case-insensitive equality
    expectConsistentPlaceholders(text, values);
  });

  it('applies the cursor as a row comparison matching the sort', () => {
    const f = filterFingerprint(parse());
    const newest = parse({ cursor: encodeCursor({ v: 1, s: 'newest', f, t: '2026-11-01 00:00:00+00', i: '9' }) });
    const nb = buildJobsQuery(newest);
    expect(nb.text).toContain('(sort_ts, id) < (');
    expect(nb.values).toContain('2026-11-01 00:00:00+00');
    expectConsistentPlaceholders(nb.text, nb.values);

    const q = parse({ q: 'x' });
    const rel = parse({ q: 'x', cursor: encodeCursor({ v: 1, s: 'relevance', f: filterFingerprint(q), t: '2026-11-01 00:00:00+00', r: 0.25, i: '9' }) });
    const rb = buildJobsQuery(rel);
    expect(rb.text).toContain('(_rel, sort_ts, id) < (');
    expect(rb.values).toContain(0.25);
    expectConsistentPlaceholders(rb.text, rb.values);
  });
});

describe('toPage', () => {
  const row = (id: number, rel?: number) => ({ id: String(id), title: `t${id}`, sort_ts: new Date(), _sort_ts: `2026-11-0${id} 00:00:00.5+00`, ...(rel !== undefined ? { _rel: rel } : {}) });

  it('returns no cursor when the page is not full', () => {
    const page = toPage(parse({ limit: '3' }), [row(1), row(2)]);
    expect(page).toMatchObject({ count: 2, limit: 3, next_cursor: null });
    expect(page).not.toHaveProperty('offset');
  });

  it('trims the look-ahead row and issues a cursor from the last returned row', () => {
    const q = parse({ limit: '2' });
    const page = toPage(q, [row(1), row(2), row(3)]);
    expect(page.jobs.map((j) => j.id)).toEqual(['1', '2']);
    expect(decodeCursor(page.next_cursor!)).toMatchObject({ s: 'newest', t: '2026-11-02 00:00:00.5+00', i: '2', f: filterFingerprint(q) });
  });

  it('strips internal columns, and exposes relevance only for searches', () => {
    const plain = toPage(parse(), [row(1)]).jobs[0];
    expect(Object.keys(plain).sort()).toEqual(['id', 'title']);
    const searched = toPage(parse({ q: 'x' }), [row(1, 0.4)]).jobs[0];
    expect(searched).toMatchObject({ id: '1', relevance: 0.4 });
    expect(searched).not.toHaveProperty('_rel');
  });

  it('carries the relevance of the last row into the cursor', () => {
    const page = toPage(parse({ q: 'x', limit: '1' }), [row(1, 0.9), row(2, 0.8)]);
    expect(decodeCursor(page.next_cursor!)).toMatchObject({ s: 'relevance', r: 0.9, i: '1' });
  });

  it('echoes offset only when offset paging was used', () => {
    expect(toPage(parse({ offset: '10' }), [row(1)])).toMatchObject({ offset: 10 });
  });
});

describe('OpenAPI spec', () => {
  it('documents exactly the parameters the parser accepts', () => {
    const documented = openapiSpec.paths['/jobs'].get.parameters.map((p) => p.name).sort();
    expect(documented).toEqual(Object.keys(JOB_PARAMS).sort());
  });

  it('has a description for every parameter', () => {
    for (const p of openapiSpec.paths['/jobs'].get.parameters) expect(p.description.length, p.name).toBeGreaterThan(10);
  });
});
