export interface Job {
  id: string;
  platform: string;
  company_slug: string;
  title: string;
  locations: string[];
  remote: boolean | null;
  department: string | null;
  employment_type: string | null;
  seniority: string | null;
  salary_min: string | null;
  salary_max: string | null;
  salary_currency: string | null;
  salary_text: string | null;
  posted_at: string | null;
  apply_url: string | null;
  first_seen: string;
  last_seen: string;
  dedupe_key: string | null;
  relevance?: number;
}
export interface JobDetail extends Job {
  key: string;
  external_id: string;
  status: 'open' | 'closed';
  description_html: string | null;
}
export interface JobsPage {
  count: number;
  limit: number;
  next_cursor: string | null;
  jobs: Job[];
}
export interface FacetValue { value: string; count: number }
export interface Facets {
  platform: FacetValue[];
  employment_type: FacetValue[];
  seniority: FacetValue[];
  department: FacetValue[];
  location: FacetValue[];
  salary_currency: FacetValue[];
}
export interface Stats {
  jobs: { platform: string; open: number; closed: number }[];
  sources: { platform: string; state: string; n: number }[];
  queue: { due: number; oldest_due: string | null };
  crawl: { ready: boolean; total: number; done: number };
  memory_mb: number;
}
