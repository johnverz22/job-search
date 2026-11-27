import { PLATFORMS, platformLabel } from './platforms';

export type Tri = 'any' | 'true' | 'false';

/** Everything the search screen can filter on. The URL query string is the only source of truth; this is its parsed form. */
export interface Filters {
  q: string;
  sort: 'relevance' | 'newest' | null; // null = API default (relevance with q, newest without)
  platform: string[];
  company: string[];
  department: string;
  location: string;
  employment_type: string[];
  seniority: string[];
  remote: Tri;
  salary_currency: string;
  min_salary: string;
  max_salary: string;
  has_salary: Tri;
  posted_within_days: number | null;
  distinct: boolean; // UI default is on
}

export const EMPTY_FILTERS: Filters = {
  q: '', sort: null, platform: [], company: [], department: '', location: '', employment_type: [], seniority: [], remote: 'any',
  salary_currency: '', min_salary: '', max_salary: '', has_salary: 'any', posted_within_days: null, distinct: true,
};

export const POSTED_OPTIONS = [
  { days: 1, label: 'Last 24 hours' },
  { days: 2, label: 'Last 48 hours' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
];
const LIST_KEYS = ['platform', 'company', 'employment_type', 'seniority'] as const;
const MAX_LIST = 20; // API limit per list parameter

const csv = (params: URLSearchParams, key: string): string[] =>
  [...new Set(params.getAll(key).flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean))].slice(0, MAX_LIST);
const tri = (v: string | null): Tri => (v === 'true' || v === 'false' ? v : 'any');
const money = (v: string | null): string => {
  const n = Number(v);
  return v !== null && v.trim() !== '' && Number.isFinite(n) && n >= 0 ? String(n) : '';
};

/** URL -> Filters. Anything the API would reject is dropped here instead of surfacing as a 400. */
export function parseFilters(params: URLSearchParams): Filters {
  const q = (params.get('q') ?? '').trim().slice(0, 200);
  const sortRaw = params.get('sort');
  const days = Number(params.get('posted_within_days'));
  const currency = (params.get('salary_currency') ?? '').trim().toUpperCase();
  const validCurrency = /^[A-Z]{3}$/.test(currency) ? currency : '';
  return {
    q,
    sort: sortRaw === 'newest' || (sortRaw === 'relevance' && q) ? sortRaw : null,
    platform: csv(params, 'platform').filter((p) => PLATFORMS.includes(p)),
    company: csv(params, 'company'),
    department: (params.get('department') ?? '').trim(),
    location: (params.get('location') ?? '').trim(),
    employment_type: csv(params, 'employment_type'),
    seniority: csv(params, 'seniority'),
    remote: tri(params.get('remote')),
    salary_currency: validCurrency,
    // The API requires a currency for any salary bound, so bounds without one are meaningless.
    min_salary: validCurrency ? money(params.get('min_salary')) : '',
    max_salary: validCurrency ? money(params.get('max_salary')) : '',
    has_salary: tri(params.get('has_salary')),
    posted_within_days: Number.isInteger(days) && days >= 1 && days <= 365 ? days : null,
    distinct: params.get('distinct') !== 'false',
  };
}

/** Filters -> the shareable URL query string (defaults omitted). */
export function toSearchString(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.sort && (f.sort === 'newest' || f.q)) p.set('sort', f.sort);
  for (const k of LIST_KEYS) if (f[k].length) p.set(k, f[k].join(','));
  if (f.department) p.set('department', f.department);
  if (f.location) p.set('location', f.location);
  if (f.remote !== 'any') p.set('remote', f.remote);
  if (f.salary_currency) {
    p.set('salary_currency', f.salary_currency);
    if (f.min_salary) p.set('min_salary', f.min_salary);
    if (f.max_salary) p.set('max_salary', f.max_salary);
  }
  if (f.has_salary !== 'any') p.set('has_salary', f.has_salary);
  if (f.posted_within_days) p.set('posted_within_days', String(f.posted_within_days));
  if (!f.distinct) p.set('distinct', 'false');
  return p.toString();
}

/** Filters -> API query parameters (same names as the URL; cursor and limit are added by the caller). */
export function toApiParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams(toSearchString(f));
  if (f.distinct) p.set('distinct', 'true');
  else p.delete('distinct');
  return p;
}

export interface Chip {
  key: string;
  label: string;
  remove: (f: Filters) => Filters;
}

/** One removable chip per active filter (the search text and sort are not chips; they have their own controls). */
export function activeChips(f: Filters): Chip[] {
  const chips: Chip[] = [];
  const list = (key: (typeof LIST_KEYS)[number], label: (v: string) => string) => {
    for (const v of f[key]) chips.push({ key: `${key}:${v}`, label: label(v), remove: (x) => ({ ...x, [key]: x[key].filter((i) => i !== v) }) });
  };
  list('platform', platformLabel);
  list('company', (v) => `Company: ${v}`);
  list('employment_type', (v) => v);
  list('seniority', (v) => v);
  if (f.department) chips.push({ key: 'department', label: `Department: ${f.department}`, remove: (x) => ({ ...x, department: '' }) });
  if (f.location) chips.push({ key: 'location', label: `Location: ${f.location}`, remove: (x) => ({ ...x, location: '' }) });
  if (f.remote !== 'any') chips.push({ key: 'remote', label: f.remote === 'true' ? 'Remote' : 'On-site or hybrid', remove: (x) => ({ ...x, remote: 'any' }) });
  if (f.salary_currency) {
    const range = [f.min_salary && `from ${f.min_salary}`, f.max_salary && `up to ${f.max_salary}`].filter(Boolean).join(' ');
    chips.push({ key: 'salary', label: `Salary ${f.salary_currency}${range ? ` ${range}` : ''}`, remove: (x) => ({ ...x, salary_currency: '', min_salary: '', max_salary: '' }) });
  }
  if (f.has_salary !== 'any') chips.push({ key: 'has_salary', label: f.has_salary === 'true' ? 'Salary listed' : 'No salary listed', remove: (x) => ({ ...x, has_salary: 'any' }) });
  if (f.posted_within_days) {
    const o = POSTED_OPTIONS.find((p) => p.days === f.posted_within_days);
    chips.push({ key: 'posted', label: o ? o.label : `Last ${f.posted_within_days} days`, remove: (x) => ({ ...x, posted_within_days: null }) });
  }
  if (!f.distinct) chips.push({ key: 'distinct', label: 'Showing duplicates', remove: (x) => ({ ...x, distinct: true }) });
  return chips;
}

/** Drops every filter but keeps the search text and sort. */
export const clearFilters = (f: Filters): Filters => ({ ...EMPTY_FILTERS, q: f.q, sort: f.sort });

/** The sort the API will actually apply, for displaying the right option. */
export const effectiveSort = (f: Filters): 'relevance' | 'newest' => f.sort ?? (f.q ? 'relevance' : 'newest');

/** Count for the "Filters (n)" button: every chip. */
export const activeFilterCount = (f: Filters) => activeChips(f).length;
