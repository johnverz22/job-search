import { describe, expect, it } from 'vitest';
import { normalizeGem } from '../src/connectors/gem.js';
import { normalizePinpoint } from '../src/connectors/pinpoint.js';
import { extractJobPostings, extractLinks, jobPostingToNormalized } from '../src/jsonld.js';

// The Gem fixture mirrors a real api.gem.com/job_board/v0/superblocks/job_posts item (trimmed).
describe('gem', () => {
  const sample = [{
    absolute_url: 'https://jobs.gem.com/superblocks/4023381005', content: '<div>Superblocks is reimagining software</div>',
    created_at: '2022-05-25T17:44:05.000Z', departments: [{ child_ids: [], id: '4010996005', name: 'Sales', parent_id: null }],
    employment_type: 'full_time', first_published_at: '2022-06-14T14:43:52.000Z', id: '4023381005', internal_job_id: '4018290005',
    location: { name: 'New York, United States' }, location_type: 'in_office',
    offices: [{ id: '1', location: { name: 'New York, United States' }, name: 'New York City (HQ)' }],
    requisition_id: '1', title: 'Account Executive, Enterprise', updated_at: '2025-08-25T15:38:40.496Z',
  }];
  it('normalizes real-shaped posts', () => {
    const [j] = normalizeGem('superblocks', sample);
    expect(j).toMatchObject({ externalId: '4023381005', title: 'Account Executive, Enterprise', department: 'Sales', employmentType: 'full_time',
      remote: false, locations: ['New York, United States'], applyUrl: 'https://jobs.gem.com/superblocks/4023381005' });
    expect(j.postedAt).toBe('2022-06-14T14:43:52.000Z');
  });
  it('maps remote and tolerates envelope/empty', () => {
    expect(normalizeGem('a', [{ id: 1, title: 'x', location_type: 'remote' }])[0].remote).toBe(true);
    expect(normalizeGem('a', { job_posts: [] })).toEqual([]);
    expect(normalizeGem('a', null)).toEqual([]);
  });
});

describe('pinpoint (shape verified live)', () => {
  it('handles flat and JSON:API-ish envelopes', () => {
    const flat = normalizePinpoint('acme', { data: [{ id: 9, title: 'Eng', url: 'https://acme.pinpointhq.com/en/postings/abc', location: { name: 'Remote' }, department: { name: 'Eng' }, workplace_type_text: 'Remote', compensation: '60000-70000 GBP' }] });
    expect(flat[0]).toMatchObject({ externalId: '9', department: 'Eng', remote: true, salaryText: '60000-70000 GBP', locations: ['Remote'] });
    // Real postings.json shape: {"data":[{id, title, ..., compensation_minimum/maximum/currency, compensation_visible}]}
    const real = normalizePinpoint('acme', { data: [{ id: '7', title: 'Ops', job: { department: { name: 'Ops' } }, location: { name: 'London' },
      workplace_type_text: 'Remote', employment_type_text: 'Permanent - Full Time', compensation_visible: true,
      compensation_minimum: 50000, compensation_maximum: 70000, compensation_currency: 'GBP', url: 'https://acme.pinpointhq.com/en/postings/x' }] });
    expect(real[0]).toMatchObject({ externalId: '7', department: 'Ops', remote: true, employmentType: 'Permanent - Full Time',
      salaryMin: 50000, salaryMax: 70000, salaryCurrency: 'GBP', salaryText: '50000-70000 GBP' });
    const hidden = normalizePinpoint('acme', { data: [{ id: '8', title: 'x', compensation_visible: false, compensation_minimum: 1, compensation_maximum: 2 }] });
    expect(hidden[0]).toMatchObject({ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryText: null });
    const wrapped = normalizePinpoint('acme', { data: [{ id: '5', attributes: { title: 'Ops' } }] });
    expect(wrapped[0]).toMatchObject({ externalId: '5', title: 'Ops', applyUrl: 'https://acme.pinpointhq.com/en/postings/5' });
    expect(normalizePinpoint('a', {})).toEqual([]);
  });
});

describe('json-ld', () => {
  const page = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Acme"},
    {"@type":"JobPosting","title":"Data Analyst","description":"<p>Crunch</p>","datePosted":"2026-11-02","employmentType":["FULL_TIME"],
    "jobLocationType":"TELECOMMUTE","jobLocation":{"@type":"Place","address":{"addressLocality":"Austin","addressRegion":"TX","addressCountry":{"name":"US"}}},
    "baseSalary":{"currency":"USD","value":{"minValue":90000,"maxValue":110000,"unitText":"YEAR"}},"identifier":{"value":"R-77"}}]}</script>
    <script type="application/ld+json">{broken</script></head></html>`;
  it('extracts and maps JobPosting', () => {
    const jps = extractJobPostings(page);
    expect(jps).toHaveLength(1);
    const j = jobPostingToNormalized(jps[0], { platform: 'jazzhr', companySlug: 'acme', url: 'https://acme.applytojob.com/apply/xyz/Data' });
    expect(j).toMatchObject({ title: 'Data Analyst', remote: true, locations: ['Austin, TX, US'], salaryMin: 90000, salaryMax: 110000, salaryCurrency: 'USD', externalId: 'R-77', employmentType: 'FULL_TIME' });
  });
  it('handles a top-level array and no postings', () => {
    expect(extractJobPostings('<script type="application/ld+json">[{"@type":"JobPosting","title":"x"}]</script>')).toHaveLength(1);
    expect(extractJobPostings('<html></html>')).toEqual([]);
  });
  it('extracts distinct links with ids', () => {
    const html = `<a href="/apply/AbC123/Job-One">1</a><a href="/apply/AbC123/Job-One">dup</a><a href="/apply/Zz9/Two">2</a><a href="/about">x</a>`;
    const links = extractLinks(html, 'https://acme.applytojob.com/apply', /^https:\/\/acme\.applytojob\.com\/apply\/([A-Za-z0-9]+)\//);
    expect(links.map((l) => l.id)).toEqual(['AbC123', 'Zz9']);
  });
});
