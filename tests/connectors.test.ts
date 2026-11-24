import { describe, expect, it } from 'vitest';
import { normalizeBamboo } from '../src/connectors/bamboohr.js';
import { normalizePersonio } from '../src/connectors/personio.js';
import { normalizeRecruitee } from '../src/connectors/recruitee.js';
import { normalizeRippling, ripplingItems } from '../src/connectors/rippling.js';
import { normalizeTeamtailor } from '../src/connectors/teamtailor.js';

// Fixtures are hand-written from the documented field names; replace with captured live responses (see docs/planning).
describe('recruitee', () => {
  it('normalizes offers', () => {
    const [j] = normalizeRecruitee('acme', {
      offers: [{ id: 1, title: 'Dev', description: '<p>d</p>', requirements: '<p>r</p>', locations: [{ city: 'Berlin', country: 'Germany' }],
        remote: true, department: 'Eng', employment_type_code: 'fulltime', salary: { min: '50000', max: '70000', currency: 'EUR', period: 'year' },
        published_at: '2026-11-01 10:00:00 UTC', careers_url: 'https://acme.recruitee.com/o/dev' }],
    });
    expect(j.externalId).toBe('1');
    expect(j.locations).toEqual(['Berlin, Germany']);
    expect(j.salaryMin).toBe(50000);
    expect(j.remote).toBe(true);
    expect(j.applyUrl).toContain('recruitee.com');
    expect(j.descriptionHtml).toContain('<p>r</p>');
  });
  it('handles empty', () => expect(normalizeRecruitee('a', {})).toEqual([]));
});

describe('personio', () => {
  const xml = `<?xml version="1.0"?><workzag-jobs><position><id>42</id><office>Munich</office><department>Sales</department>
    <name>AE</name><jobDescriptions><jobDescription><name>Tasks</name><value><![CDATA[<ul><li>sell</li></ul>]]></value></jobDescription></jobDescriptions>
    <employmentType>permanent</employmentType><seniority>experienced</seniority><createdAt>2026-10-10T08:00:00+00:00</createdAt></position></workzag-jobs>`;
  it('parses xml', () => {
    const [j] = normalizePersonio('acme', xml);
    expect(j).toMatchObject({ externalId: '42', title: 'AE', department: 'Sales', locations: ['Munich'], seniority: 'experienced' });
    expect(j.descriptionHtml).toContain('<li>sell</li>');
    expect(j.applyUrl).toBe('https://acme.jobs.personio.de/job/42');
  });
  it('handles a single position and none', () => {
    expect(normalizePersonio('a', '<workzag-jobs></workzag-jobs>')).toEqual([]);
  });
});

describe('teamtailor', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><item>
    <guid>abc-1</guid><pubDate>Mon, 02 Nov 2026 09:00:00 +0000</pubDate><title>Designer</title><description>&lt;p&gt;hi&lt;/p&gt;</description>
    <link>https://careers.acme.com/jobs/1-designer</link><remoteStatus>fully</remoteStatus><tt:department>Design</tt:department>
    <tt:locations><tt:location><tt:name>HQ</tt:name><tt:city>Stockholm</tt:city><tt:country>Sweden</tt:country></tt:location></tt:locations></item></channel></rss>`;
  it('parses rss', () => {
    const [j] = normalizeTeamtailor('careers.acme.com', xml);
    expect(j).toMatchObject({ externalId: 'abc-1', title: 'Designer', department: 'Design', remote: true, locations: ['Stockholm, Sweden'] });
    expect(j.descriptionHtml).toBe('<p>hi</p>');
  });
});

describe('rippling', () => {
  it('accepts several envelope shapes', () => {
    expect(ripplingItems({ items: [{}] })).toHaveLength(1);
    expect(ripplingItems([{}, {}])).toHaveLength(2);
    expect(ripplingItems({})).toEqual([]);
  });
  it('normalizes', () => {
    const [j] = normalizeRippling('acme', [{ uuid: 'u1', name: 'PM', url: 'https://ats.rippling.com/acme/jobs/u1', department: { name: 'Product' }, workLocation: { name: 'Remote (US)' }, workplaceType: 'REMOTE' }]);
    expect(j).toMatchObject({ externalId: 'u1', department: 'Product', remote: true, locations: ['Remote (US)'] });
  });
});

describe('bamboohr', () => {
  it('merges list and detail', () => {
    const j = normalizeBamboo('acme', { id: 7, jobOpeningName: 'Ops', departmentLabel: 'Operations', employmentStatusLabel: 'Full-Time', location: { city: 'Austin', state: 'TX' }, isRemote: false },
      { result: { jobOpening: { description: '<p>x</p>', datePosted: '2026-11-03', compensation: '$80k' } } });
    expect(j).toMatchObject({ externalId: '7', locations: ['Austin, TX'], remote: false, salaryText: '$80k', applyUrl: 'https://acme.bamboohr.com/careers/7' });
    expect(j.postedAt).toContain('2026-11-03');
  });
  it('works without detail', () => expect(normalizeBamboo('a', { id: 1, jobOpeningName: 'X' }).descriptionHtml).toBeNull());
});
