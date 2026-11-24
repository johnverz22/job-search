import { XMLParser } from 'fast-xml-parser';
import { HttpError, getText } from '../http.js';
import type { Connector, NormalizedJob } from '../types.js';
import { arr, iso, str } from '../util.js';

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === 'position' || name === 'jobDescription',
});

export function normalizePersonio(slug: string, xml: string, host = 'jobs.personio.de'): NormalizedJob[] {
  const doc = parser.parse(xml);
  return arr<any>(doc?.['workzag-jobs']?.position).map((p) => {
    const description = arr<any>(p.jobDescriptions?.jobDescription)
      .map((d) => `${d.name ? `<h3>${d.name}</h3>` : ''}${d.value ?? ''}`)
      .join('\n');
    const id = String(p.id);
    return {
      platform: 'personio',
      companySlug: slug,
      externalId: id,
      title: String(p.name ?? ''),
      descriptionHtml: description || null,
      locations: [str(p.office)].filter((x): x is string => !!x),
      remote: null,
      department: str(p.department),
      employmentType: str(p.employmentType) ?? str(p.schedule),
      seniority: str(p.seniority),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryText: null,
      postedAt: iso(p.createdAt),
      applyUrl: `https://${slug}.${host}/job/${id}`,
      raw: p,
    } satisfies NormalizedJob;
  });
}

export const personio: Connector = {
  platform: 'personio',
  async fetchJobs(slug) {
    for (const host of ['jobs.personio.de', 'jobs.personio.com']) {
      try {
        const xml = await getText(`https://${slug}.${host}/xml?language=en`);
        return normalizePersonio(slug, xml, host);
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 404) throw e;
      }
    }
    throw new HttpError(404, `https://${slug}.jobs.personio.{de,com}/xml`);
  },
};
