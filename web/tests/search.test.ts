import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, activeChips, activeFilterCount, clearFilters, effectiveSort, parseFilters, toApiParams, toSearchString } from '../src/lib/search';

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));

describe('URL <-> filters', () => {
  it('empty URL gives defaults (duplicates hidden) and an empty URL back', () => {
    expect(parse('')).toEqual(EMPTY_FILTERS);
    expect(toSearchString(EMPTY_FILTERS)).toBe('');
  });

  it('round-trips every filter', () => {
    const f = { ...EMPTY_FILTERS, q: 'react "senior dev"', sort: 'newest' as const, platform: ['gem', 'workday'], company: ['acme'], department: 'Eng', location: 'Berlin',
      employment_type: ['Full time'], seniority: ['Senior'], remote: 'true' as const, salary_currency: 'EUR', min_salary: '50000', max_salary: '90000',
      has_salary: 'true' as const, posted_within_days: 7, distinct: false };
    expect(parse(toSearchString(f))).toEqual(f);
  });

  it('accepts repeated and comma-separated lists, de-duplicates, and caps at the API limit of 20', () => {
    expect(parse('platform=gem,workday&platform=gem&platform=icims').platform).toEqual(['gem', 'workday', 'icims']);
    const many = Array.from({ length: 30 }, (_, i) => `c${i}`).join(',');
    expect(parse(`company=${many}`).company).toHaveLength(20);
  });

  it('drops values the API would reject instead of sending them', () => {
    expect(parse('platform=gem,nonsense').platform).toEqual(['gem']);
    expect(parse('sort=relevance').sort).toBeNull(); // relevance needs q
    expect(parse('q=x&sort=relevance').sort).toBe('relevance');
    expect(parse('sort=bogus').sort).toBeNull();
    expect(parse('remote=maybe').remote).toBe('any');
    expect(parse('posted_within_days=0').posted_within_days).toBeNull();
    expect(parse('posted_within_days=366').posted_within_days).toBeNull();
    expect(parse('posted_within_days=abc').posted_within_days).toBeNull();
    expect(parse('q=' + 'a'.repeat(300)).q).toHaveLength(200);
  });

  it('salary bounds require a valid currency (the API rejects them otherwise)', () => {
    expect(parse('min_salary=50000')).toMatchObject({ min_salary: '', salary_currency: '' });
    expect(parse('salary_currency=usd&min_salary=50000')).toMatchObject({ salary_currency: 'USD', min_salary: '50000' });
    expect(parse('salary_currency=dollars&min_salary=5')).toMatchObject({ salary_currency: '', min_salary: '' });
    expect(parse('salary_currency=USD&min_salary=-5&max_salary=abc')).toMatchObject({ min_salary: '', max_salary: '' });
    expect(toSearchString({ ...EMPTY_FILTERS, min_salary: '10' })).toBe(''); // bound without currency is not emitted
  });

  it('never emits relevance sort without q, and drops cursor-bound state (none is stored)', () => {
    expect(toSearchString({ ...EMPTY_FILTERS, sort: 'relevance' })).toBe('');
    expect(toSearchString({ ...EMPTY_FILTERS, q: 'a', sort: 'relevance' })).toBe('q=a&sort=relevance');
    expect(toSearchString(EMPTY_FILTERS)).not.toContain('cursor');
  });

  it('API params: distinct=true is sent while on, omitted while off', () => {
    expect(toApiParams(EMPTY_FILTERS).get('distinct')).toBe('true');
    expect(toApiParams({ ...EMPTY_FILTERS, distinct: false }).has('distinct')).toBe(false);
    expect(toApiParams(parse('q=a&remote=false&platform=gem,workday')).toString()).toBe('q=a&platform=gem%2Cworkday&remote=false&distinct=true');
  });

  it('effectiveSort reflects the API default', () => {
    expect(effectiveSort(EMPTY_FILTERS)).toBe('newest');
    expect(effectiveSort({ ...EMPTY_FILTERS, q: 'x' })).toBe('relevance');
    expect(effectiveSort({ ...EMPTY_FILTERS, q: 'x', sort: 'newest' })).toBe('newest');
  });
});

describe('chips', () => {
  const f = parse('q=x&platform=gem,workday&remote=true&salary_currency=EUR&min_salary=50000&posted_within_days=7&distinct=false&location=Berlin');
  it('one chip per active filter; q is not a chip; count matches', () => {
    expect(activeChips(f).map((c) => c.key)).toEqual(['platform:gem', 'platform:workday', 'location', 'remote', 'salary', 'posted', 'distinct']);
    expect(activeFilterCount(f)).toBe(7);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });
  it('removing a chip removes only that filter', () => {
    const c = activeChips(f);
    expect(c[0]!.remove(f).platform).toEqual(['workday']);
    const noSalary = c.find((x) => x.key === 'salary')!.remove(f);
    expect(noSalary).toMatchObject({ salary_currency: '', min_salary: '', max_salary: '', remote: 'true' });
    expect(c.find((x) => x.key === 'distinct')!.remove(f).distinct).toBe(true);
  });
  it('clearFilters keeps the search text', () => {
    expect(clearFilters(f)).toEqual({ ...EMPTY_FILTERS, q: 'x' });
  });
});
