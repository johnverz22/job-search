import { beforeEach, describe, expect, it, vi } from 'vitest';

// Replace the network layer: `h.route(url, opts)` returns the body (object for JSON, string for text) or undefined for a 404.
const h = vi.hoisted(() => ({
  route: ((_url: string, _opts?: any): unknown => undefined) as (url: string, opts?: any) => unknown,
  calls: [] as string[],
}));
vi.mock('../src/http.js', async () => {
  const actual = await vi.importActual<typeof import('../src/http.js')>('../src/http.js');
  const handle = async (url: string, opts?: any) => {
    h.calls.push(`${opts?.method ?? 'GET'} ${url}`);
    const r = h.route(url, opts);
    if (r === undefined) throw new actual.HttpError(404, url);
    return r;
  };
  return { ...actual, getJson: handle, getText: handle };
});

import { bamboohr } from '../src/connectors/bamboohr.js';
import { icims, jobvite } from '../src/connectors/htmlJsonLd.js';
import { personio } from '../src/connectors/personio.js';
import { recruitee } from '../src/connectors/recruitee.js';
import { parseTaleoSlug, taleo } from '../src/connectors/taleo.js';
import { facetLeaves, fetchWorkday, normalizeWorkday, parseWorkdaySlug, pickSplitFacet, workdayId } from '../src/connectors/workday.js';
import { isFresh } from '../src/detailCache.js';
import { careersPages, discoverCustomDomains, probeHost, type Fetchers } from '../src/discovery/customDomains.js';
import { detectAts, extractSlug } from '../src/discovery/patterns.js';
import type { FetchContext, NormalizedJob, PreviousJob } from '../src/types.js';
import { stableStringify } from '../src/util.js';

beforeEach(() => {
  h.calls = [];
  h.route = () => undefined;
});

/** What the worker would load from the store after saving `jobs`. */
const toPrevious = (jobs: NormalizedJob[]): FetchContext => ({
  previous: new Map<string, PreviousJob>(jobs.map((j) => [j.externalId, { raw: JSON.parse(JSON.stringify(j.raw)), detailFetchedAt: j.detailFetchedAt ?? null }])),
});
const hoursAgo = (n: number) => new Date(Date.now() - n * 3600_000).toISOString();
const details = () => h.calls.filter((c) => /\/detail$/.test(c));

describe('detail cache primitives', () => {
  it('isFresh honours the TTL and missing timestamps', () => {
    const p = (detailFetchedAt: string | null): PreviousJob => ({ raw: {}, detailFetchedAt });
    expect(isFresh(p(hoursAgo(1)))).toBe(true);
    expect(isFresh(p(hoursAgo(24 * 30)))).toBe(false);
    expect(isFresh(p(null))).toBe(false);
    expect(isFresh(p('garbage'))).toBe(false);
    expect(isFresh(undefined)).toBe(false);
    expect(isFresh(p(hoursAgo(2)), 3600_000)).toBe(false);
  });
  it('stableStringify ignores key order', () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: [1, { y: 1, x: 2 }] } })).toBe(stableStringify({ b: { d: [1, { x: 2, y: 1 }], c: 2 }, a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

describe('bamboohr detail cache', () => {
  const list = (items: any[]) => ({ result: items });
  const item = (id: number, name = `Job ${id}`) => ({ id, jobOpeningName: name, departmentLabel: 'Ops', location: { city: 'Austin', state: 'TX' } });
  const serve = (items: any[], failDetail = false) => {
    h.route = (url) => {
      if (url.endsWith('/careers/list')) return list(items);
      const m = url.match(/\/careers\/(\d+)\/detail$/);
      if (m && !failDetail) return { result: { jobOpening: { description: `<p>desc ${m[1]}</p>`, datePosted: '2026-11-01' } } };
      return undefined;
    };
  };

  it('first crawl fetches every detail; an identical re-crawl fetches none', async () => {
    serve([item(1), item(2)]);
    const first = await bamboohr.fetchJobs('acme', { previous: new Map() });
    expect(details()).toHaveLength(2);
    expect(first.map((j) => j.descriptionHtml)).toEqual(['<p>desc 1</p>', '<p>desc 2</p>']);
    expect(first.every((j) => j.detailFetchedAt)).toBe(true);

    h.calls = [];
    const second = await bamboohr.fetchJobs('acme', toPrevious(first));
    expect(details()).toHaveLength(0);
    expect(second).toEqual(first);
  });

  it('only fetches the new job when the board gains one (the changed-crawl case)', async () => {
    serve([item(1), item(2)]);
    const first = await bamboohr.fetchJobs('acme', { previous: new Map() });
    serve([item(1), item(2), item(3)]);
    h.calls = [];
    const second = await bamboohr.fetchJobs('acme', toPrevious(first));
    expect(details()).toEqual(['GET https://acme.bamboohr.com/careers/3/detail']);
    expect(second).toHaveLength(3);
  });

  it('refetches a job whose list entry changed, and one whose detail is past the TTL', async () => {
    serve([item(1), item(2)]);
    const first = await bamboohr.fetchJobs('acme', { previous: new Map() });
    const prev = toPrevious(first);
    prev.previous!.get('2')!.detailFetchedAt = hoursAgo(24 * 30);
    serve([item(1, 'Job 1 renamed'), item(2)]);
    h.calls = [];
    await bamboohr.fetchJobs('acme', prev);
    expect(details().sort()).toEqual(['GET https://acme.bamboohr.com/careers/1/detail', 'GET https://acme.bamboohr.com/careers/2/detail']);
  });

  it('keeps the stored description when a refetch fails, and a never-fetched job gets no detail timestamp', async () => {
    serve([item(1)]);
    const first = await bamboohr.fetchJobs('acme', { previous: new Map() });
    const prev = toPrevious(first);
    prev.previous!.get('1')!.detailFetchedAt = hoursAgo(24 * 30);
    serve([item(1)], true);
    const [again] = await bamboohr.fetchJobs('acme', prev);
    expect(again.descriptionHtml).toBe('<p>desc 1</p>');
    expect(again.detailFetchedAt).toBe(prev.previous!.get('1')!.detailFetchedAt);

    const [bare] = await bamboohr.fetchJobs('acme', { previous: new Map() });
    expect(bare.descriptionHtml).toBeNull();
    expect(bare.detailFetchedAt).toBeNull();
  });

  it('rejects a non-board response', async () => {
    h.route = () => ({ nope: true });
    await expect(bamboohr.fetchJobs('x', { previous: new Map() })).rejects.toThrow(/unexpected list response/);
  });
});

describe('html/json-ld detail cache (jobvite)', () => {
  const page = (title: string) => `<script type="application/ld+json">{"@type":"JobPosting","title":"${title}","description":"<p>${title}</p>","datePosted":"2026-11-01"}</script>`;
  const serve = (ids: string[], broken: string[] = []) => {
    h.route = (url) => {
      if (url === 'https://jobs.jobvite.com/acme/jobs') return ids.map((i) => `<a href="/acme/job/${i}">x</a>`).join('');
      const m = url.match(/\/job\/(\w+)$/);
      return m && ids.includes(m[1]) && !broken.includes(m[1]) ? page(`Title ${m[1]}`) : undefined;
    };
  };
  const pages = () => h.calls.filter((c) => c.includes('/job/'));

  it('fetches new jobs only on later crawls', async () => {
    serve(['a1', 'b2']);
    const first = await jobvite.fetchJobs('acme', { previous: new Map() });
    expect(pages()).toHaveLength(2);
    h.calls = [];
    expect(await jobvite.fetchJobs('acme', toPrevious(first))).toEqual(first);
    expect(pages()).toHaveLength(0);

    serve(['a1', 'b2', 'c3']);
    h.calls = [];
    const third = await jobvite.fetchJobs('acme', toPrevious(first));
    expect(pages()).toEqual(['GET https://jobs.jobvite.com/acme/job/c3']);
    expect(third.map((j) => j.externalId)).toEqual(['a1', 'b2', 'c3']);
  });

  it('a transient page failure keeps the job (stale copy) instead of dropping it', async () => {
    serve(['a1', 'b2']);
    const first = await jobvite.fetchJobs('acme', { previous: new Map() });
    const prev = toPrevious(first);
    prev.previous!.get('b2')!.detailFetchedAt = hoursAgo(24 * 30);
    serve(['a1', 'b2'], ['b2']);
    const again = await jobvite.fetchJobs('acme', prev);
    expect(again.map((j) => j.externalId)).toEqual(['a1', 'b2']);
    expect(again[1].title).toBe('Title b2');
  });

  it('a new job whose page fails is skipped until a later crawl', async () => {
    serve(['a1'], ['a1']);
    expect(await jobvite.fetchJobs('acme', { previous: new Map() })).toEqual([]);
  });
});

describe('icims', () => {
  const jp = (id: string) => `<script type="application/ld+json">{"@type":"JobPosting","title":"Role ${id}"}</script>`;
  it('walks result pages until one adds nothing, and fetches the bare in-iframe job URL', async () => {
    h.route = (url) => {
      const pr = url.match(/pr=(\d+)/)?.[1];
      if (url.includes('/jobs/search')) {
        if (pr === '0') return `<a href="/jobs/101/role-a/job?mobile=false&width=1">a</a><a href="/jobs/102/role-b/job?x=1">b</a>`;
        if (pr === '1') return `<a href="/jobs/103/role-c/job">c</a>`;
        return `<a href="/jobs/103/role-c/job">c</a>`; // repeats: no new ids, the walk ends
      }
      const m = url.match(/\/jobs\/(\d+)\//);
      return m ? jp(m[1]) : undefined;
    };
    const jobs = await icims.fetchJobs('careers-acme', { previous: new Map() });
    expect(jobs.map((j) => j.externalId)).toEqual(['101', '102', '103']);
    expect(h.calls.filter((c) => c.includes('/job?in_iframe=1'))).toHaveLength(3);
    expect(h.calls.filter((c) => c.includes('/jobs/search'))).toHaveLength(3);
  });
  it('fails when the first listing page fails (not a board)', async () => {
    await expect(icims.fetchJobs('nope', { previous: new Map() })).rejects.toThrow(/404/);
  });
});

describe('taleo (tbe)', () => {
  it('parses slugs strictly', () => {
    expect(parseTaleoSlug('phf/phf01/ACME/37')).toEqual({ sub: 'phf', pod: 'phf01', org: 'ACME', cws: '37' });
    expect(() => parseTaleoSlug('phf/ACME')).toThrow();
  });
  it('lists via searchResults and reads viewRequisition links regardless of query param order', async () => {
    h.route = (url) => {
      if (url.includes('searchResults')) {
        return url.includes('pageNum=2')
          ? `<a href="/phf01/ats/careers/v2/viewRequisition?org=ACME&amp;cws=37&amp;rid=5">x</a>` // repeat: walk ends
          : `<a href="/phf01/ats/careers/v2/viewRequisition?org=ACME&amp;cws=37&amp;rid=5">x</a><a href="/phf01/ats/careers/v2/viewRequisition?cws=37&amp;rid=6&amp;org=ACME">y</a><a href="/other">z</a>`;
      }
      return url.includes('viewRequisition') ? `<script type="application/ld+json">{"@type":"JobPosting","title":"T"}</script>` : undefined;
    };
    const jobs = await taleo.fetchJobs('phf/phf01/ACME/37', { previous: new Map() });
    expect(jobs.map((j) => j.externalId)).toEqual(['5', '6']);
  });
});

describe('workday', () => {
  it('parses the slug', () => {
    expect(parseWorkdaySlug('NVIDIA.wd5/NVIDIAExternalCareerSite')).toEqual({ tenant: 'nvidia', wd: 'wd5', site: 'NVIDIAExternalCareerSite' });
    expect(() => parseWorkdaySlug('nvidia')).toThrow(/bad slug/);
  });

  it('normalizes list + detail', () => {
    const item = { title: 'Engineer', externalPath: '/job/Santa-Clara/Engineer_JR1', locationsText: '2 Locations', postedOn: 'Posted Today', bulletFields: ['JR1'] };
    const info = { jobDescription: '<p>d</p>', location: 'Santa Clara, CA', additionalLocations: ['Remote, US'], remoteType: 'Remote', timeType: 'Full time', startDate: '2026-11-20' };
    const j = normalizeWorkday('acme.wd5/Ext', item, info, '2026-11-26T00:00:00.000Z');
    expect(j).toMatchObject({ externalId: 'JR1', title: 'Engineer', descriptionHtml: '<p>d</p>', locations: ['Santa Clara, CA', 'Remote, US'], remote: true, employmentType: 'Full time', detailFetchedAt: '2026-11-26T00:00:00.000Z' });
    expect(j.postedAt).toContain('2026-11-20');
    expect(j.applyUrl).toBe('https://acme.wd5.myworkdayjobs.com/Ext/job/Santa-Clara/Engineer_JR1');
    // Without detail: a "2 Locations" label is not a location; the single-location text is.
    expect(normalizeWorkday('acme.wd5/Ext', item).locations).toEqual([]);
    expect(normalizeWorkday('acme.wd5/Ext', { ...item, locationsText: 'Berlin' }).locations).toEqual(['Berlin']);
    expect(normalizeWorkday('acme.wd5/Ext', item).detailFetchedAt).toBeNull();
    expect(workdayId({ externalPath: '/job/X/Y_1' })).toBe('job/X/Y_1');
  });

  const facets = [
    { facetParameter: 'locationMainGroup', values: [{ facetParameter: 'locations', values: [{ descriptor: 'A', id: 'locA', count: 1200 }, { descriptor: 'B', id: 'locB', count: 1300 }] }] },
    { facetParameter: 'timeType', values: [{ descriptor: 'FT', id: 'ft', count: 2400 }, { descriptor: 'PT', id: 'pt', count: 100 }] },
    { facetParameter: 'jobFamily', values: [{ descriptor: 'only', id: 'x', count: 2500 }] },
  ];
  it('flattens grouped facets and picks the split with best coverage', () => {
    const leaves = facetLeaves(facets);
    expect([...leaves.keys()].sort()).toEqual(['jobFamily', 'locations', 'timeType']);
    expect(leaves.get('locations')!.map((l) => l.id)).toEqual(['locA', 'locB']);
    const pick = pickSplitFacet(facets, {}, 2500)!;
    expect(pick.param).toBe('locations'); // covers all 2500 with the smaller biggest bucket; jobFamily has one value, timeType covers 2500 too but a 2400 bucket
    expect(pickSplitFacet(facets, { locations: ['locA'], timeType: ['ft'] }, 2500)).toBeNull(); // jobFamily has a single value: nothing useful left
    expect(pickSplitFacet(null, {}, 10)).toBeNull();
  });

  const posting = (n: number, tag: string) => ({ title: `Job ${tag}${n}`, externalPath: `/job/L/${tag}${n}`, locationsText: 'X', bulletFields: [`${tag}${n}`] });
  const lists = (all: Record<string, any[]>, totals: Record<string, number>, rootFacets?: unknown) => {
    h.route = (url, opts) => {
      if (opts?.method === 'POST') {
        const key = JSON.stringify(opts.body.appliedFacets);
        const items = all[key] ?? [];
        const off = opts.body.offset as number;
        return { total: off === 0 ? totals[key] ?? items.length : 0, jobPostings: items.slice(off, off + 20), facets: off === 0 && key === '{}' ? rootFacets : [] };
      }
      const m = url.match(/\/job\/L\/(\w+)$/);
      return m ? { jobPostingInfo: { jobDescription: `<p>${m[1]}</p>`, startDate: '2026-11-01', location: 'Berlin' } } : undefined;
    };
  };

  it('pages 20 at a time and fetches details once, then reuses them', async () => {
    const items = Array.from({ length: 45 }, (_, i) => posting(i, 'j'));
    lists({ '{}': items }, { '{}': 45 });
    const first = await fetchWorkday('acme.wd5/Ext', { previous: new Map() });
    expect(first).toHaveLength(45);
    expect(h.calls.filter((c) => c.startsWith('POST'))).toHaveLength(3); // offsets 0, 20, 40
    expect(h.calls.filter((c) => c.startsWith('GET'))).toHaveLength(45);
    expect(first[0].descriptionHtml).toBe('<p>j0</p>');

    h.calls = [];
    const second = await fetchWorkday('acme.wd5/Ext', toPrevious(first));
    expect(h.calls.filter((c) => c.startsWith('GET'))).toHaveLength(0);
    expect(second).toEqual(first);
  });

  it('splits a >2,000 result query by facet and merges the buckets without duplicates', async () => {
    const a = Array.from({ length: 30 }, (_, i) => posting(i, 'a'));
    const b = Array.from({ length: 25 }, (_, i) => posting(i, 'b'));
    const shared = posting(99, 's'); // appears in both locations
    lists({ [JSON.stringify({ locations: ['locA'] })]: [...a, shared], [JSON.stringify({ locations: ['locB'] })]: [...b, shared] }, { '{}': 2500, [JSON.stringify({ locations: ['locA'] })]: 31, [JSON.stringify({ locations: ['locB'] })]: 26 }, facets);
    const jobs = await fetchWorkday('acme.wd5/Ext', { previous: new Map() });
    expect(jobs).toHaveLength(30 + 25 + 1);
    expect(new Set(jobs.map((j) => j.externalId)).size).toBe(56);
    expect(h.calls.filter((c) => c.startsWith('POST'))).toHaveLength(5); // root probe + locA (31 -> 2 pages) + locB (26 -> 2 pages)
  });

  it('rejects a response that is not a CXS list', async () => {
    h.route = () => ({ error: 'x' });
    await expect(fetchWorkday('acme.wd5/Ext')).rejects.toThrow(/unexpected list response/);
  });
});

describe('discovery rules for the new platforms', () => {
  it.each([
    ['https://careers-acme.icims.com/jobs/1234/title/job', { platform: 'icims', slug: 'careers-acme' }],
    ['https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite', { platform: 'workday', slug: 'nvidia.wd5/NVIDIAExternalCareerSite' }],
    ['https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Santa-Clara/x_JR1', { platform: 'workday', slug: 'nvidia.wd5/NVIDIAExternalCareerSite' }],
    ['https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs', { platform: 'workday', slug: 'nvidia.wd5/NVIDIAExternalCareerSite' }],
    ['https://phf.tbe.taleo.net/phf01/ats/careers/v2/searchResults?org=ACME&cws=37', { platform: 'taleo', slug: 'phf/phf01/ACME/37' }],
    ['https://www.ycombinator.com/companies/airbnb/jobs/abc123-engineer', { platform: 'yc', slug: 'airbnb' }],
    ['https://www.workatastartup.com/companies/Stripe', { platform: 'yc', slug: 'stripe' }],
  ])('%s', (url, expected) => expect(extractSlug(url as string)).toEqual(expected));

  it('rejects hosts without a site, company pages that are not job pages, and vendor infrastructure', () => {
    for (const u of [
      'https://nvidia.wd5.myworkdayjobs.com/', 'https://nvidia.wd5.myworkdayjobs.com/en-US', 'https://nvidia.wd5.myworkdayjobs.com/en-US/',
      'https://phf.tbe.taleo.net/phf01/ats/careers/v2/searchResults', 'https://www.ycombinator.com/companies/airbnb', 'https://www.ycombinator.com/companies',
      'https://www.icims.com/', 'https://login.icims.com/', 'https://wd5.myworkdayjobs.com/Site',
    ]) expect(extractSlug(u), u).toBeNull();
  });
});

describe('custom-domain detection', () => {
  it('careersPages: bare domains expand to likely careers hosts, URLs with a path are used as given, junk is skipped', () => {
    expect(careersPages('acme.com')).toEqual(['https://acme.com/', 'https://careers.acme.com/', 'https://jobs.acme.com/', 'https://acme.com/careers']);
    expect(careersPages('https://www.acme.com')).toEqual(['https://www.acme.com/', 'https://careers.acme.com/', 'https://jobs.acme.com/', 'https://acme.com/careers']);
    expect(careersPages('https://acme.com/about/jobs')).toEqual(['https://acme.com/about/jobs']);
    for (const junk of ['', '   ', '# comment', 'localhost', 'not a url']) expect(careersPages(junk)).toBeNull();
  });

  const fakes = (sites: Record<string, string | object>): Fetchers => ({
    text: async (u) => (typeof sites[u] === 'string' ? (sites[u] as string) : null),
    json: async (u) => (typeof sites[u] === 'object' ? (sites[u] as object) : null),
  });

  it('probeHost recognises Recruitee and Personio payloads and ignores look-alikes', async () => {
    expect(await probeHost('careers.acme.com', fakes({ 'https://careers.acme.com/api/offers/': { offers: [] } }))).toEqual([{ platform: 'recruitee', slug: 'careers.acme.com' }]);
    expect(await probeHost('careers.acme.com', fakes({ 'https://careers.acme.com/xml?language=en': '<workzag-jobs></workzag-jobs>' }))).toEqual([{ platform: 'personio', slug: 'careers.acme.com' }]);
    expect(await probeHost('careers.acme.com', fakes({ 'https://careers.acme.com/api/offers/': { hello: 1 }, 'https://careers.acme.com/xml?language=en': '<html>hi</html>' }))).toEqual([]);
  });

  it('discoverCustomDomains combines page scanning (Rippling embed, vendor links) with host probes', async () => {
    const out = await discoverCustomDomains(
      ['acme.com', 'beta.io', '# skip', 'dead.example'],
      fakes({
        'https://careers.acme.com/': '<a href="https://ats.rippling.com/acme-inc/jobs">jobs</a>',
        'https://jobs.acme.com/': '<script>fetch("https://api.rippling.com/platform/api/ats/v2/board/acme-inc/jobs")</script>',
        'https://careers.beta.io/': '<html>careers</html>',
        'https://careers.beta.io/api/offers/': { offers: [{ id: 1 }] },
      }),
      () => {},
    );
    expect(out).toEqual(expect.arrayContaining([{ platform: 'rippling', slug: 'acme-inc' }, { platform: 'recruitee', slug: 'careers.beta.io' }]));
    expect(out).toHaveLength(2);
  });

  it('detectAts finds a Rippling board API call embedded on a custom domain', () => {
    expect(detectAts('<script>x("https://api.rippling.com/platform/api/ats/v2/board/acme-inc/jobs?page=0")</script>')).toEqual([{ platform: 'rippling', slug: 'acme-inc' }]);
  });

  it('recruitee and personio connectors treat a dotted slug as a custom careers host', async () => {
    h.route = (url) => (url === 'https://careers.acme.com/api/offers/' ? { offers: [{ id: 7, title: 'Dev' }] } : url === 'https://careers.acme.com/xml?language=en' ? '<workzag-jobs><position><id>3</id><name>AE</name></position></workzag-jobs>' : undefined);
    expect((await recruitee.fetchJobs('careers.acme.com'))[0]).toMatchObject({ externalId: '7', companySlug: 'careers.acme.com' });
    expect((await personio.fetchJobs('careers.acme.com'))[0]).toMatchObject({ externalId: '3', applyUrl: 'https://careers.acme.com/job/3' });
    h.route = () => ({ not: 'recruitee' });
    await expect(recruitee.fetchJobs('careers.other.com')).rejects.toThrow(/not a Recruitee careers site/);
    h.route = () => '<html></html>';
    await expect(personio.fetchJobs('careers.other.com')).rejects.toThrow(/not a Personio careers site/);
  });
});
