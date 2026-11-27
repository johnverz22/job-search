import { describe, expect, it } from 'vitest';
import { cachedFacets, computeFacets, FACET_LIMIT } from '../src/facets.js';
import type { JobRecord } from '../src/model.js';
import { parseJobsQuery } from '../src/query.js';
import { parseText, searchJobs, stem, toDetailRow, toPage } from '../src/search.js';
import type { NormalizedJob } from '../src/types.js';
import { fakeAggregator, record } from './helpers/records.js';

const NOW = Date.parse('2026-11-27T00:00:00Z');
const named: Record<string, JobRecord> = {};
const add = (name: string, o: Partial<NormalizedJob> & { title: string }, firstSeen?: string) => (named[name] = record(name, o, firstSeen));

add('react-dev', {
  title: 'Senior React Developer', department: 'Engineering', locations: ['Berlin, Germany'], remote: true, employmentType: 'Full-time',
  seniority: 'Senior', salaryMin: 90000, salaryMax: 120000, salaryCurrency: 'EUR', postedAt: '2026-11-20T09:00:00Z',
  descriptionHtml: '<p>Build UIs with React and TypeScript.</p>',
});
add('frontend', {
  title: 'Frontend Engineer', platform: 'recruitee', department: 'Engineering', locations: ['Paris, France'], remote: false,
  employmentType: 'Full-time', seniority: 'Mid', salaryMin: 60000, salaryMax: 80000, salaryCurrency: 'EUR', postedAt: '2026-11-18T09:00:00Z',
  descriptionHtml: '<div class="python">We use React daily</div>',
});
add('python', {
  title: 'Python Backend Developer', platform: 'personio', companySlug: 'globex', locations: ['Munich'], postedAt: '2026-11-15T09:00:00Z',
  descriptionHtml: '<p>Django and Postgres. You will be developing APIs.</p>',
});
add('designer', {
  title: 'Product Designer', companySlug: 'globex-corp', department: 'Design', locations: ['Remote - EU'], remote: true,
  salaryMin: 50000, salaryCurrency: 'EUR',
}, '2026-11-10T00:00:00Z');
add('sales', {
  title: 'Account Executive', platform: 'teamtailor', companySlug: 'initech', department: 'Sales & Marketing', locations: ['New York, NY'],
  remote: false, employmentType: 'part_time', salaryMin: 70000, salaryMax: 90000, salaryCurrency: 'USD', postedAt: '2026-11-05T09:00:00Z',
  descriptionHtml: '<p>Drive revenue &amp; growth</p>',
});
// same company/title/locations => same dedupeKey
add('dup-old', { title: 'Data Analyst', companySlug: 'dupco', postedAt: '2026-11-12T09:00:00Z' });
add('dup-new', { title: 'Data Analyst', companySlug: 'dupco', platform: 'recruitee', postedAt: '2026-11-13T09:00:00Z' });
add('percent', { title: 'Ops Lead', companySlug: 'pct', department: '100% Remote Ops', locations: ['Bogotá'], postedAt: '2026-11-04T09:00:00Z' });
add('huge', { title: 'Growth Marketer', companySlug: 'huge', postedAt: '2026-11-06T09:00:00Z', descriptionHtml: `<p>quokka ${'lorem ipsum '.repeat(100_000)} zebrafinal</p>` });
add('cpp', { title: 'C++ Developer', companySlug: 'native', postedAt: '2026-11-03T09:00:00Z' });
for (let n = 1; n <= 11; n++) add(`tie-${n}`, { title: `Tie Engineer ${n}`, companySlug: 'tiebreak', postedAt: '2026-10-01T12:00:00Z' });

const ALL = Object.values(named);
const run = (raw: Record<string, string | string[]>, all: readonly JobRecord[] = ALL) => {
  const q = parseJobsQuery(raw);
  return toPage(q, searchJobs(all, q, NOW));
};
const titles = (raw: Record<string, string | string[]>) => run(raw).jobs.map((j) => j.title);
const sorted = (raw: Record<string, string | string[]>) => titles(raw).sort();
const ids = (raw: Record<string, string | string[]>) => run({ limit: '200', ...raw }).jobs.map((j) => j.id);

function walk(raw: Record<string, string>, all: readonly JobRecord[] = ALL) {
  const pages = [run(raw, all)];
  while (pages.at(-1)!.next_cursor) {
    pages.push(run({ ...raw, cursor: pages.at(-1)!.next_cursor! }, all));
    expect(pages.length).toBeLessThan(1000);
  }
  return pages;
}

describe('text search', () => {
  it('ranks a title match above a description-only match', () => {
    const { jobs } = run({ q: 'react' });
    expect(jobs.map((j) => j.title)).toEqual(['Senior React Developer', 'Frontend Engineer']);
    expect(jobs[0].relevance).toBeGreaterThan(jobs[1].relevance!);
  });
  it('stems lightly and matches word prefixes', () => {
    expect(sorted({ q: 'developing', company: 'acme,globex' })).toEqual(['Python Backend Developer', 'Senior React Developer']);
    expect(titles({ q: 'designers' })).toEqual(['Product Designer']);
    expect([stem('running'), stem('classes'), stem('sales'), stem('class'), stem('used')]).toEqual(['run', 'class', 'sale', 'class', 'used']);
  });
  it('does not match in the middle of a word, and short terms must be whole words', () => {
    expect(titles({ q: 'eact' })).toEqual([]);
    expect(titles({ q: 'c++' })).toEqual(['C++ Developer']); // "c" must not match "company", "corp", ...
  });
  it('requires every term; supports phrases, exclusion and or', () => {
    expect(titles({ q: 'react typescript' })).toEqual(['Senior React Developer']);
    expect(titles({ q: '"react developer"' })).toEqual(['Senior React Developer']);
    expect(sorted({ q: 'developer -react -c' })).toEqual(['Python Backend Developer']);
    expect(sorted({ q: 'python or designer' })).toEqual(['Product Designer', 'Python Backend Developer']);
    expect(sorted({ q: 'react senior or designer' })).toEqual(['Product Designer', 'Senior React Developer']);
    expect(titles({ q: 'developer -"react developer" -c' })).toEqual(['Python Backend Developer']);
  });
  it('searches visible text only, plus department and company', () => {
    expect(titles({ q: 'python' })).toEqual(['Python Backend Developer']);
    expect(titles({ q: 'div' })).toEqual([]);
    expect(titles({ q: 'amp' })).toEqual([]);
    expect(titles({ q: 'revenue' })).toEqual(['Account Executive']);
    expect(titles({ q: 'sales' })).toEqual(['Account Executive']);
    expect(sorted({ q: 'globex' })).toEqual(['Product Designer', 'Python Backend Developer']);
  });
  it('indexes only the beginning of a huge description', () => {
    expect(titles({ q: 'quokka' })).toEqual(['Growth Marketer']);
    expect(titles({ q: 'zebrafinal' })).toEqual([]);
  });
  it('returns nothing for stop-word-only queries', () => {
    expect(titles({ q: 'the' })).toEqual([]);
    expect(titles({ q: 'or' })).toEqual([]);
    expect(parseText('the and of')).toEqual({ groups: [], excluded: [] });
  });
  it('survives hostile and unicode input', () => {
    for (const q of ['"unclosed', '(((', '&|!:*', "'; DROP TABLE jobs; --", '-', '\\', '[a-z]+(', '.*', '日本語', '🚀', 'a'.repeat(200), '- - -', '""']) {
      expect(() => run({ q }), q).not.toThrow();
    }
    expect(titles({ q: '.*' })).toEqual([]);
    expect(titles({ q: 'bogotá', location: 'bogot' })).toEqual([]); // location is not part of text search
  });
  it('includes relevance only when sorting by relevance', () => {
    expect(run({ q: 'react' }).jobs[0]).toHaveProperty('relevance');
    expect(run({ q: 'react', sort: 'newest' }).jobs[0]).not.toHaveProperty('relevance');
    expect(run({}).jobs[0]).not.toHaveProperty('relevance');
  });
  it('sorts by newest when asked, even with q', () => {
    expect(titles({ q: 'engineer', company: 'acme' })).toEqual(['Frontend Engineer', 'Senior React Developer']);
    expect(titles({ q: 'engineer', company: 'acme', sort: 'newest' })).toEqual(['Senior React Developer', 'Frontend Engineer']);
  });
});

describe('filters', () => {
  it('platform and company, single and multiple', () => {
    expect(titles({ platform: 'recruitee', company: 'acme' })).toEqual(['Frontend Engineer']);
    expect(sorted({ platform: 'gem,personio', company: 'acme,globex' })).toEqual(['Python Backend Developer', 'Senior React Developer']);
    expect(titles({ platform: ['teamtailor', 'personio'] })).toEqual(['Python Backend Developer', 'Account Executive']);
  });
  it('department and location are case-insensitive substrings, taken literally', () => {
    expect(sorted({ department: 'ENGINEER' })).toEqual(['Frontend Engineer', 'Senior React Developer']);
    expect(titles({ location: 'berlin' })).toEqual(['Senior React Developer']);
    expect(titles({ location: 'new york' })).toEqual(['Account Executive']);
    expect(titles({ location: 'Bogotá' })).toEqual(['Ops Lead']);
    expect(titles({ department: '%' })).toEqual(['Ops Lead']);
    expect(titles({ department: '1_0' })).toEqual([]);
    expect(titles({ location: 'B_rlin' })).toEqual([]);
  });
  it('remote true/false are exact; unknown matches neither', () => {
    const company = 'acme,globex,globex-corp,initech';
    expect(sorted({ remote: 'true', company })).toEqual(['Product Designer', 'Senior React Developer']);
    expect(sorted({ remote: 'false', company })).toEqual(['Account Executive', 'Frontend Engineer']);
    expect(ids({ remote: 'false' })).not.toContain(named.python.id);
    expect(ids({ remote: 'true' })).not.toContain(named.python.id);
  });
  it('employment_type and seniority are case-insensitive exact', () => {
    expect(titles({ employment_type: 'FULL-TIME' })).toEqual(['Senior React Developer', 'Frontend Engineer']);
    expect(titles({ employment_type: 'part_time' })).toEqual(['Account Executive']);
    expect(titles({ employment_type: 'full' })).toEqual([]);
    expect(titles({ seniority: 'senior' })).toEqual(['Senior React Developer']);
  });
  it('salary bounds use range overlap within one currency', () => {
    expect(titles({ min_salary: '100000', salary_currency: 'eur' })).toEqual(['Senior React Developer']);
    expect(titles({ max_salary: '55000', salary_currency: 'EUR' })).toEqual(['Product Designer']);
    expect(titles({ min_salary: '75000', max_salary: '85000', salary_currency: 'EUR' })).toEqual(['Frontend Engineer']);
    expect(titles({ min_salary: '70000', salary_currency: 'USD' })).toEqual(['Account Executive']);
    expect(ids({ min_salary: '1', salary_currency: 'EUR' })).not.toContain(named.python.id);
  });
  it('has_salary', () => {
    expect(ids({ has_salary: 'true' })).toHaveLength(4);
    expect(ids({ has_salary: 'false' })).toContain(named.python.id);
    expect(ids({ has_salary: 'false' })).not.toContain(named['react-dev'].id);
  });
  it('posted filters fall back to firstSeen when there is no posted date', () => {
    expect(ids({ posted_after: '2026-11-09T00:00:00Z' })).toContain(named.designer.id);
    expect(ids({ posted_after: '2026-11-11' })).not.toContain(named.designer.id);
    expect(ids({ posted_within_days: '30' })).toHaveLength(ALL.filter((r) => r.sortTs >= NOW - 30 * 86_400_000).length);
  });
  it('distinct keeps the first duplicate in sort order and never collapses empty keys', () => {
    expect(ids({ company: 'dupco' })).toHaveLength(2);
    expect(ids({ company: 'dupco', distinct: 'true' })).toEqual([named['dup-new'].id]);
    expect(ids({ company: 'dupco', distinct: 'true', q: 'analyst' })).toEqual([named['dup-new'].id]);
    const legacy = [record('a', { companySlug: 'x' }), record('b', { companySlug: 'x' })].map((r) => ({ ...r, dedupeKey: '' }));
    expect(run({ distinct: 'true' }, legacy).jobs).toHaveLength(2);
  });
});

describe('cursor pagination', () => {
  const oracle = (list: JobRecord[]) => [...list].sort((a, b) => b.sortTs - a.sortTs || b.id.localeCompare(a.id)).map((r) => r.id);

  it('walks everything exactly once in newest order, including identical timestamps', () => {
    for (const limit of [1, 2, 3, 7, 200]) {
      const pages = walk({ limit: String(limit) });
      expect(pages.flatMap((p) => p.jobs.map((j) => j.id)), `limit=${limit}`).toEqual(oracle(ALL));
      for (const p of pages.slice(0, -1)) expect(p.jobs).toHaveLength(limit);
    }
  });
  it('walks a relevance search with equal scores exactly once', () => {
    const expected = run({ q: 'engineer', limit: '200' }).jobs.map((j) => j.id);
    expect(expected.length).toBeGreaterThanOrEqual(13);
    for (const limit of [1, 2, 5]) {
      const jobs = walk({ q: 'engineer', limit: String(limit) }).flatMap((p) => p.jobs);
      expect(jobs.map((j) => j.id)).toEqual(expected);
      expect(jobs.map((j) => j.relevance)).toEqual([...jobs.map((j) => j.relevance!)].sort((a, b) => b - a));
    }
  });
  it('paginates distinct results without repeating a group', () => {
    const best = oracle(ALL).filter((id) => id !== named['dup-old'].id);
    for (const limit of [1, 3]) expect(walk({ distinct: 'true', limit: String(limit) }).flatMap((p) => p.jobs.map((j) => j.id))).toEqual(best);
    expect(walk({ distinct: 'true', limit: '1', q: 'analyst' })).toHaveLength(1);
  });
  it('rejects a cursor used with different filters or sort', () => {
    const { next_cursor } = run({ q: 'engineer', limit: '1' });
    expect(() => parseJobsQuery({ q: 'engineer', limit: '1', remote: 'true', cursor: next_cursor! })).toThrow(/different filters/);
    expect(() => parseJobsQuery({ q: 'engineer', limit: '1', sort: 'newest', cursor: next_cursor! })).toThrow(/different sort/);
  });
  it('supports offset paging and an empty page', () => {
    const page = run({ limit: '3', offset: '2' });
    expect(page.jobs.map((j) => j.id)).toEqual(ids({}).slice(2, 5));
    expect(page.offset).toBe(2);
    expect(page.next_cursor).toBeTruthy();
    expect(run({ company: 'does-not-exist' })).toMatchObject({ count: 0, next_cursor: null, jobs: [] });
  });
});

describe('rows and facets', () => {
  it('detail rows keep the API shape', () => {
    const row = toDetailRow(named['react-dev']);
    expect(row).toMatchObject({ status: 'open', salary_min: '90000', salary_max: '120000', external_id: 'react-dev' });
    expect(row.description_html).toContain('React and TypeScript');
    expect(row).not.toHaveProperty('raw');
    expect(row).not.toHaveProperty('search');
    expect(row).not.toHaveProperty('sortTs');
  });
  it('counts values, unnests locations, orders by count and caps at 50', () => {
    const f = computeFacets(ALL);
    expect(f.platform.reduce((n, v) => n + v.count, 0)).toBe(ALL.length);
    expect(f.location).toContainEqual({ value: 'Berlin, Germany', count: 1 });
    expect(f.salary_currency).toEqual([{ value: 'EUR', count: 3 }, { value: 'USD', count: 1 }]);
    const many = Array.from({ length: 80 }, (_, i) => record(`m${i}`, { department: `D${i}` }));
    expect(computeFacets(many).department).toHaveLength(FACET_LIMIT);
  });
  it('caches facets per aggregator version', () => {
    const agg = fakeAggregator(ALL);
    const get = cachedFacets(agg);
    expect(get()).toBe(get());
    const before = get();
    agg.set([named.python]);
    expect(get()).not.toBe(before);
    expect(get().platform).toEqual([{ value: 'personio', count: 1 }]);
  });
});

/** Synthetic but realistically sized corpus (~4 kB of description text per job). */
function corpus(n: number): JobRecord[] {
  const vocab = 'team product customer build design data cloud platform service growth support quality delivery roadmap ownership we’re collaborate'.split(' ');
  const body = (seed: number) => Array.from({ length: 550 }, (_, i) => vocab[(seed * 31 + i * 7) % vocab.length]).join(' ');
  return Array.from({ length: n }, (_, i) => record(`s${i}`, {
    title: i % 10 === 0 ? 'Software Engineer' : 'Account Manager', companySlug: `company-${i % 500}`, remote: i % 3 === 0,
    locations: [i % 2 ? 'Manila' : 'Berlin'], postedAt: new Date(NOW - (i % 10_000) * 60_000).toISOString(),
    descriptionHtml: `<p>${body(i)}${i % 100 === 0 ? ' kubernetes' : ''}</p>`,
  }));
}

describe('scale', () => {
  const big = corpus(50_000);
  it('stays responsive on 50k jobs', () => {
    run({}, big); // builds the newest-first view once
    const timings: Record<string, number> = {};
    for (const [name, raw] of Object.entries<Record<string, string>>({
      newest: {}, filtered: { remote: 'true', location: 'manila' }, common: { q: 'engineer' }, rare: { q: 'kubernetes' }, miss: { q: 'zzzznothing' },
    })) {
      run(raw, big); // warm-up: the first scan of a string also flattens it
      const t = performance.now();
      run(raw, big);
      timings[name] = Math.round(performance.now() - t);
    }
    console.log('search timings on 50k jobs (ms):', timings);
    expect(timings.newest).toBeLessThan(100);
    expect(timings.filtered).toBeLessThan(100);
    // Text searches scan every description; the bound is loose so slow CI machines do not flake.
    expect(Math.max(timings.common, timings.rare, timings.miss)).toBeLessThan(1500);
  }, 60_000);
  it('cursor walk over 20k records matches an independent sort', () => {
    const set = big.slice(0, 20_000);
    const expected = [...set].sort((a, b) => b.sortTs - a.sortTs || b.id.localeCompare(a.id)).map((r) => r.id);
    expect(walk({ limit: '200' }, set).flatMap((p) => p.jobs.map((j) => j.id))).toEqual(expected);
  }, 60_000);
});
