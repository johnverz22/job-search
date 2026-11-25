export const PLATFORMS = [
  'recruitee', 'personio', 'teamtailor', 'rippling', 'bamboohr', 'gem', 'pinpoint', 'jazzhr', 'jobvite',
  'icims', 'taleo', 'workday', 'yc',
] as const;
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
  /** When this job's detail was last fetched (ISO). Set by connectors that make one request per job; persisted for the detail cache. */
  detailFetchedAt?: string | null;
}

/** What the store already knows about one job of the source being crawled; handed to connectors that opt into the detail cache. */
export interface PreviousJob {
  raw: unknown;
  detailFetchedAt: string | null;
}

export interface FetchContext {
  /** external_id -> stored job. Only provided to connectors with `cachesDetail: true`. */
  previous?: Map<string, PreviousJob>;
}

export interface Connector {
  platform: Platform;
  /** `slug` is the company identifier; for Teamtailor it is the careers host (e.g. "acme.teamtailor.com" or "careers.acme.com"). */
  fetchJobs(slug: string, ctx?: FetchContext): Promise<NormalizedJob[]>;
  /** True if the connector reuses `ctx.previous` to skip per-job detail requests; the worker then loads it. */
  cachesDetail?: boolean;
}
