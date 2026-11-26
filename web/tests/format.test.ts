import { describe, expect, it } from 'vitest';
import { companyName, formatSalary, locationSummary, relativeDate } from '../src/lib/format';

describe('companyName', () => {
  it.each([
    ['recruitee', 'acme-inc', 'Acme Inc'],
    ['gem', 'big_corp', 'Big Corp'],
    ['workday', 'nvidia.wd5/NVIDIAExternalCareerSite', 'Nvidia'],
    ['taleo', 'phf/phf01/ACME/37', 'Acme'],
    ['icims', 'careers-acme', 'Acme'],
    ['teamtailor', 'acme.teamtailor.com', 'Acme'],
    ['recruitee', 'careers.acme.com', 'Acme'],
    ['yc', 'airbnb', 'Airbnb'],
  ])('%s %s -> %s', (platform, slug, expected) => expect(companyName(platform, slug)).toBe(expected));
  it('never returns an empty string', () => expect(companyName('gem', '---')).toBe('---'));
});

describe('formatSalary', () => {
  const j = (o: object) => ({ salary_min: null, salary_max: null, salary_currency: null, salary_text: null, ...o });
  it('prefers the platform text, then a formatted range, else null', () => {
    expect(formatSalary(j({ salary_text: ' $100k–$120k ' }))).toBe('$100k–$120k');
    expect(formatSalary(j({ salary_min: '80000', salary_max: '120000', salary_currency: 'usd' }))).toBe('$80,000 – $120,000');
    expect(formatSalary(j({ salary_min: '80000', salary_currency: 'EUR' }))).toBe('€80,000');
    expect(formatSalary(j({ salary_min: '5', salary_max: '5', salary_currency: 'USD' }))).toBe('$5');
    expect(formatSalary(j({}))).toBeNull();
    expect(formatSalary(j({ salary_min: 'abc' }))).toBeNull();
  });
  it('survives an invalid currency code and a missing currency', () => {
    expect(formatSalary(j({ salary_min: '1000', salary_currency: 'XX1' }))).toBe('XX1 1,000');
    expect(formatSalary(j({ salary_min: '1000' }))).toBe('1,000');
  });
});

describe('relativeDate', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  it.each([
    ['2026-11-26T01:00:00Z', 'today'], ['2026-11-25T01:00:00Z', 'yesterday'], ['2026-11-20T00:00:00Z', '6 days ago'],
    ['2026-11-05T00:00:00Z', '3 weeks ago'], ['2026-08-26T00:00:00Z', '3 months ago'], ['2024-01-01T00:00:00Z', '2 years ago'],
    ['2026-12-31T00:00:00Z', 'today'],
  ])('%s -> %s', (iso, out) => expect(relativeDate(iso, now)).toBe(out));
  it('null for missing or bad dates', () => {
    expect(relativeDate(null, now)).toBeNull();
    expect(relativeDate('nope', now)).toBeNull();
  });
});

describe('locationSummary', () => {
  it('summarizes', () => {
    expect(locationSummary([])).toBeNull();
    expect(locationSummary(['Berlin'])).toBe('Berlin');
    expect(locationSummary(['A', 'B', 'C', 'D'])).toBe('A · B +2');
  });
});
