import { describe, expect, it } from 'vitest';
import {
  MAX_LIMIT, QueryError, decodeCursor, encodeCursor, filterFingerprint, parseJobsQuery, type CursorPayload,
} from '../src/query.js';
import { openapiSpec } from '../src/openapi.js';

const parse = (raw: Record<string, unknown> = {}) => parseJobsQuery(raw);
const rejects = (raw: Record<string, unknown>, msg: RegExp) => {
  expect(() => parse(raw)).toThrow(QueryError);
  expect(() => parse(raw)).toThrow(msg);
};

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
  const base: CursorPayload = { v: 2, s: 'newest', f: filterFingerprint(parse()), t: 1_793_000_000_000, i: 'abc123abc123' };

  it('round-trips', () => {
    expect(decodeCursor(encodeCursor(base))).toEqual(base);
    const rel = { ...base, s: 'relevance' as const, r: 12 };
    expect(decodeCursor(encodeCursor(rel))).toEqual(rel);
  });

  it('rejects malformed cursors', () => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    for (const bad of [
      'not-base64-json', enc(null), enc([]), enc({ ...base, v: 1 }), enc({ ...base, s: 'oldest' }), enc({ ...base, t: '2026' }),
      enc({ ...base, i: '1; DROP' }), enc({ ...base, i: 42 }), enc({ ...base, i: 'ABC123ABC123' }),
      enc({ ...base, s: 'relevance' }), // relevance cursor must carry a rank
      enc({ ...base, r: 1 }), // newest cursor must not
      enc({ ...base, s: 'relevance', r: 'high' }),
    ]) {
      expect(() => decodeCursor(bad), String(bad)).toThrow(/invalid cursor/);
    }
  });

  it('rejects a cursor replayed with a different sort or different filters', () => {
    const q = parse({ q: 'react', remote: 'true' });
    const cur = encodeCursor({ ...base, s: 'relevance', f: filterFingerprint(q), r: 5 });
    expect(parse({ q: 'react', remote: 'true', cursor: cur }).cursor?.i).toBe(base.i);
    rejects({ q: 'react', remote: 'true', sort: 'newest', cursor: cur }, /different sort/);
    rejects({ q: 'react', remote: 'false', cursor: cur }, /different filters/);
    rejects({ q: 'vue', remote: 'true', cursor: cur }, /different filters/);
  });

  it('fingerprint ignores paging parameters', () => {
    expect(filterFingerprint(parse({ q: 'a', limit: '10' }))).toBe(filterFingerprint(parse({ q: 'a', limit: '100', offset: '40' })));
  });
});

describe('OpenAPI spec', () => {
  it('has a description for every parameter', () => {
    for (const p of openapiSpec.paths['/jobs'].get.parameters) expect(p.description.length, p.name).toBeGreaterThan(10);
  });
});
