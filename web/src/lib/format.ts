import type { Job } from '../api/types';

const titleCase = (s: string) =>
  s.split(/[-_\s]+/).filter(Boolean).map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join(' ');

/**
 * Companies only have a slug (the ATS identifier). Turn it into something readable; the slug shape depends on the platform.
 * Heuristic and display-only: nothing keys off the result.
 */
export function companyName(platform: string, slug: string): string {
  let s = slug;
  if (platform === 'workday') s = slug.split('.')[0] ?? slug; // tenant.wd5/site
  else if (platform === 'taleo') s = slug.split('/')[2] ?? slug; // sub/pod/org/cws
  else if (platform === 'icims') s = slug.replace(/^(careers|jobs|external|internal)-/, '');
  else if (slug.includes('.')) {
    const labels = slug.split('.').filter((l) => !['www', 'careers', 'jobs', 'com', 'net', 'org', 'io', 'co', 'de', 'teamtailor'].includes(l));
    s = labels[0] ?? slug; // careers.acme.com, acme.teamtailor.com
  }
  return titleCase(s) || slug;
}

export function formatSalary(job: Pick<Job, 'salary_min' | 'salary_max' | 'salary_currency' | 'salary_text'>): string | null {
  if (job.salary_text?.trim()) return job.salary_text.trim();
  const min = job.salary_min === null ? null : Number(job.salary_min);
  const max = job.salary_max === null ? null : Number(job.salary_max);
  if ((min === null || !Number.isFinite(min)) && (max === null || !Number.isFinite(max))) return null;
  const cur = job.salary_currency?.toUpperCase() ?? null;
  const fmt = (n: number) => {
    try {
      return cur ? new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n) : new Intl.NumberFormat('en').format(n);
    } catch {
      return `${cur} ${new Intl.NumberFormat('en').format(n)}`; // not a valid ISO code
    }
  };
  const lo = min !== null && Number.isFinite(min) ? min : null;
  const hi = max !== null && Number.isFinite(max) ? max : null;
  if (lo !== null && hi !== null && lo !== hi) return `${fmt(lo)} – ${fmt(hi)}`;
  return fmt((lo ?? hi)!);
}

const DAY = 86_400_000;
/** "today", "3 days ago", "2 weeks ago", "5 months ago". Future dates (clock skew) read as "today". */
export function relativeDate(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now - t) / DAY);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export const fullDate = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }) : null);

/** First two locations plus "+N". Empty means unknown, not remote. */
export function locationSummary(locations: string[]): string | null {
  if (!locations.length) return null;
  const shown = locations.slice(0, 2).join(' · ');
  return locations.length > 2 ? `${shown} +${locations.length - 2}` : shown;
}
