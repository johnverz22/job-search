import { describe, expect, it } from 'vitest';
import { detectAts, extractSlug, slugOk } from '../src/discovery/patterns.js';
import { parseCdxLines, parseCrtSh } from '../src/discovery/sources.js';

describe('extractSlug', () => {
  it.each([
    ['https://acme.recruitee.com/o/dev', { platform: 'recruitee', slug: 'acme' }],
    ['acme-gmbh.jobs.personio.de/xml', { platform: 'personio', slug: 'acme-gmbh' }],
    ['https://acme.jobs.personio.com/job/1', { platform: 'personio', slug: 'acme' }],
    ['https://acme.bamboohr.com/careers/12', { platform: 'bamboohr', slug: 'acme' }],
    ['https://acme.pinpointhq.com/en/postings/x', { platform: 'pinpoint', slug: 'acme' }],
    ['https://acme.applytojob.com/apply/AbC/Job', { platform: 'jazzhr', slug: 'acme' }],
    ['https://acme.teamtailor.com/jobs', { platform: 'teamtailor', slug: 'acme.teamtailor.com' }],
    ['https://jobs.gem.com/Nominal/abc123', { platform: 'gem', slug: 'nominal' }],
    ['https://jobs.jobvite.com/acme/job/oXyz', { platform: 'jobvite', slug: 'acme' }],
    ['https://ats.rippling.com/acme-inc/jobs', { platform: 'rippling', slug: 'acme-inc' }],
  ])('%s', (url, expected) => expect(extractSlug(url as string)).toEqual(expected));

  it('rejects vendor infrastructure and unrelated hosts', () => {
    for (const u of ['https://www.recruitee.com/', 'https://api.recruitee.com/x', 'https://app.bamboohr.com', 'https://jobs.gem.com/', 'https://example.com/acme', 'not a url', 'https://a.b.recruitee.com'])
      expect(extractSlug(u)).toBeNull();
  });
  it('slugOk', () => {
    expect(slugOk('acme-1')).toBe(true);
    expect(slugOk('Careers')).toBe(false);
    expect(slugOk('-bad')).toBe(false);
  });
});

describe('detectAts', () => {
  it('finds boards in links, escaped JSON and protocol-relative embeds; detects teamtailor custom domain', () => {
    const html = `<a href="https://acme.recruitee.com/o/x">x</a><script>var u="https:\\/\\/jobs.gem.com\\/beta\\/123"</script>
      <script src="//acme2.bamboohr.com/js/embed.js"></script><script src="https://scripts.teamtailor-cdn.com/widgets/x.js"></script>
      <a href="https://example.com/jobs">no</a>`;
    const found = detectAts(html, 'https://careers.gamma.io/jobs');
    expect(found).toEqual(expect.arrayContaining([
      { platform: 'recruitee', slug: 'acme' }, { platform: 'gem', slug: 'beta' }, { platform: 'bamboohr', slug: 'acme2' },
      { platform: 'teamtailor', slug: 'careers.gamma.io' },
    ]));
    expect(found).toHaveLength(4);
  });
});

describe('source parsers', () => {
  it('parseCrtSh handles multi-line names, wildcards, dupes', () => {
    const rows = [{ name_value: 'acme.recruitee.com\n*.recruitee.com\nwww.recruitee.com' }, { name_value: 'ACME.recruitee.com' }, { name_value: 'beta.recruitee.com' }];
    expect(parseCrtSh(rows)).toEqual([{ platform: 'recruitee', slug: 'acme' }, { platform: 'recruitee', slug: 'beta' }]);
    expect(parseCrtSh(null as any)).toEqual([]);
  });
  it('parseCdxLines tolerates blanks and garbage', () => {
    const body = `{"url": "https://jobs.gem.com/nominal/abc"}\n\nnot json\n{"url": "https://jobs.gem.com/nominal/def"}\n{"url": "https://jobs.gem.com/linktree"}\n`;
    expect(parseCdxLines(body)).toEqual([{ platform: 'gem', slug: 'nominal' }, { platform: 'gem', slug: 'linktree' }]);
  });
});
