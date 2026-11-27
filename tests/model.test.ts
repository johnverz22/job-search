import { describe, expect, it } from 'vitest';
import { MAX_BODY_CHARS, MAX_DESCRIPTION_CHARS, htmlToSearchText, isJobId, jobId, jobKey, toRecord } from '../src/model.js';
import type { NormalizedJob } from '../src/types.js';

const job = (o: Partial<NormalizedJob> = {}): NormalizedJob => ({
  platform: 'gem', companySlug: 'acme-inc', externalId: 'abc', title: 'Senior React Developer', descriptionHtml: '<p>Build <b>things</b></p>', locations: ['Berlin'],
  remote: true, department: 'Engineering', employmentType: 'Full time', seniority: 'Senior', salaryMin: 1, salaryMax: 2, salaryCurrency: 'eur', salaryText: null,
  postedAt: '2026-11-01T00:00:00Z', applyUrl: 'https://x.example', raw: { a: 1 }, ...o,
});
const NOW = new Date('2026-11-27T12:00:00Z');

describe('ids', () => {
  it('jobId is 12 lowercase hex chars and stable', () => {
    const k = jobKey('gem', 'acme', '1');
    expect(k).toBe('gem:acme:1');
    expect(jobId(k)).toMatch(/^[0-9a-f]{12}$/);
    expect(jobId(k)).toBe(jobId('gem:acme:1'));
    expect(jobId(k)).not.toBe(jobId('gem:acme:2'));
    expect(isJobId(jobId(k))).toBe(true);
  });
  it.each(['', '123', 'ABCDEF123456', '0123456789abcdeg', '0123456789abc', 'abc def 1234'])('rejects %j as an id', (s) => expect(isJobId(s)).toBe(false));
});

describe('toRecord', () => {
  it('maps fields, builds search text and computes sortTs from postedAt', () => {
    const r = toRecord(job(), undefined, NOW);
    expect(r).toMatchObject({ key: 'gem:acme-inc:abc', platform: 'gem', title: 'Senior React Developer', salaryCurrency: 'EUR', firstSeen: NOW.toISOString(), lastSeen: NOW.toISOString(), detailFetchedAt: null });
    expect(r.id).toBe(jobId(r.key));
    expect(r.sortTs).toBe(Date.parse('2026-11-01T00:00:00Z'));
    expect(r.search).toEqual({ title: 'senior react developer', department: 'engineering', company: 'acme inc', body: 'build things' });
    expect(r.dedupeKey).toMatch(/^[0-9a-f]{40}$/);
    expect(r.raw).toEqual({ a: 1 });
  });

  it('keeps firstSeen from the previous record but refreshes lastSeen', () => {
    const first = toRecord(job(), undefined, new Date('2026-10-01T00:00:00Z'));
    const again = toRecord(job({ title: 'Renamed' }), first, NOW);
    expect(again.firstSeen).toBe(first.firstSeen);
    expect(again.lastSeen).toBe(NOW.toISOString());
    expect(again.title).toBe('Renamed');
    expect(again.id).toBe(first.id);
  });

  it('sorts by firstSeen when there is no (or an invalid) postedAt', () => {
    const none = toRecord(job({ postedAt: null }), undefined, NOW);
    expect(none.sortTs).toBe(NOW.getTime());
    expect(none.postedAt).toBeNull();
    const bad = toRecord(job({ postedAt: 'not a date' }), undefined, NOW);
    expect(bad.sortTs).toBe(NOW.getTime());
    expect(bad.postedAt).toBeNull();
    const old = toRecord(job({ postedAt: null }), toRecord(job(), undefined, new Date('2026-01-01T00:00:00Z')), NOW);
    expect(old.sortTs).toBe(Date.parse('2026-01-01T00:00:00Z'));
  });

  it('normalizes postedAt to an ISO instant', () => {
    expect(toRecord(job({ postedAt: '2026-11-01' }), undefined, NOW).postedAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('caps the stored description and the search body', () => {
    const big = '<p>' + 'word '.repeat(60_000) + '</p>';
    const r = toRecord(job({ descriptionHtml: big }), undefined, NOW);
    expect(r.descriptionHtml!.length).toBe(MAX_DESCRIPTION_CHARS);
    expect(r.search.body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(r.search.body.length).toBeGreaterThan(MAX_BODY_CHARS - 10);
  });

  it('handles missing optional fields', () => {
    const r = toRecord(job({ descriptionHtml: null, department: null, salaryCurrency: null, detailFetchedAt: '2026-11-20T00:00:00Z' }), undefined, NOW);
    expect(r.descriptionHtml).toBeNull();
    expect(r.search.body).toBe('');
    expect(r.search.department).toBe('');
    expect(r.salaryCurrency).toBeNull();
    expect(r.detailFetchedAt).toBe('2026-11-20T00:00:00Z');
  });

  it('company search text splits slug separators (workday tenant.wdN/site, dotted hosts)', () => {
    expect(toRecord(job({ companySlug: 'nvidia.wd5/NVIDIAExternalCareerSite' }), undefined, NOW).search.company).toBe('nvidia wd5 nvidiaexternalcareersite');
  });
});

describe('htmlToSearchText', () => {
  it('strips tags, scripts and styles, decodes entities, collapses whitespace, lowercases', () => {
    expect(htmlToSearchText('<h1>Hello</h1><script>evil()</script><style>p{}</style><p>R&amp;D&nbsp;team &lt;3 &#233;t&#xE9;</p>')).toBe('hello r&d team <3 été');
  });
  it('drops a tag cut in half by the size cap instead of indexing its attributes', () => {
    expect(htmlToSearchText('<p>visible text</p><a href="https://tracking.example/x?utm=1')).toBe('visible text');
    const r = toRecord(job({ descriptionHtml: '<p>' + 'a'.repeat(MAX_DESCRIPTION_CHARS - 20) + '</p><a href="https://tracking.example/very/long/url/that/gets/cut">link</a>' }), undefined, NOW);
    expect(r.search.body).not.toContain('tracking');
  });
  it('is safe on junk', () => {
    expect(htmlToSearchText(null)).toBe('');
    expect(htmlToSearchText('')).toBe('');
    expect(htmlToSearchText('&#99999999999; &#0; <unclosed')).toBe('');
    expect(htmlToSearchText('a <b>b</b> c')).toBe('a b c');
    expect(htmlToSearchText('x'.repeat(50), 10)).toBe('x'.repeat(10));
  });
});
