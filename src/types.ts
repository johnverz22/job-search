export const PLATFORMS = ['recruitee', 'personio', 'teamtailor', 'rippling', 'bamboohr', 'gem', 'pinpoint', 'jazzhr', 'jobvite'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface NormalizedJob {
  platform: Platform;
  companySlug: string;
  externalId: string;
  title: string;
  descriptionHtml: string | null;
  locations: string[];
  remote: boolean | null;
  department: string | null;
  employmentType: string | null;
  seniority: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryText: string | null;
  postedAt: string | null; // ISO 8601
  applyUrl: string | null;
  raw: unknown;
}

export interface Connector {
  platform: Platform;
  /** `slug` is the company identifier; for Teamtailor it is the careers host (e.g. "acme.teamtailor.com" or "careers.acme.com"). */
  fetchJobs(slug: string): Promise<NormalizedJob[]>;
}
