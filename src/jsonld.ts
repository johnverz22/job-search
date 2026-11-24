import type { NormalizedJob, Platform } from './types.js';
import { arr, iso, joinParts, num, str } from './util.js';

const SCRIPT_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const isJobPosting = (o: any): boolean => {
  const t = o?.['@type'];
  return Array.isArray(t) ? t.includes('JobPosting') : t === 'JobPosting';
};

function collect(node: any, out: any[]) {
  if (Array.isArray(node)) return node.forEach((n) => collect(n, out));
  if (!node || typeof node !== 'object') return;
  if (isJobPosting(node)) out.push(node);
  if (node['@graph']) collect(node['@graph'], out);
}

/** Returns every schema.org JobPosting object found in the page's ld+json blocks. */
export function extractJobPostings(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(SCRIPT_RE)) {
    try {
      collect(JSON.parse(m[1].trim()), out);
    } catch {
      /* ignore malformed blocks */
    }
  }
  return out;
}

const countryOf = (c: any): string | null => (typeof c === 'string' ? str(c) : str(c?.name));

export function jobPostingToNormalized(
  jp: any,
  ctx: { platform: Platform; companySlug: string; url: string; externalId?: string },
): NormalizedJob {
  const locs = arr<any>(jp.jobLocation)
    .map((l) => {
      const a = l?.address ?? {};
      return typeof a === 'string' ? str(a) : joinParts(a.addressLocality, a.addressRegion, countryOf(a.addressCountry)) || null;
    })
    .filter((x): x is string => !!x);
  const sal = jp.baseSalary;
  const v = sal?.value ?? {};
  const min = num(v.minValue ?? (typeof v.value === 'number' ? v.value : undefined));
  const max = num(v.maxValue);
  const idv = jp.identifier;
  const ident = typeof idv === 'object' ? str(idv?.value) : str(idv);
  return {
    platform: ctx.platform,
    companySlug: ctx.companySlug,
    externalId: ctx.externalId ?? ident ?? ctx.url,
    title: String(jp.title ?? ''),
    descriptionHtml: str(jp.description),
    locations: locs,
    remote: str(jp.jobLocationType)?.toUpperCase() === 'TELECOMMUTE' ? true : null,
    department: str(jp.occupationalCategory),
    employmentType: str(arr(jp.employmentType).join(', ')),
    seniority: null,
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: str(sal?.currency),
    salaryText: min != null || max != null ? `${min ?? ''}-${max ?? ''} ${sal?.currency ?? ''} ${v.unitText ?? ''}`.trim() : null,
    postedAt: iso(jp.datePosted),
    applyUrl: str(jp.url) ?? ctx.url,
    raw: jp,
  };
}

/** Distinct absolute URLs from href attributes matching `pattern` (must contain one capture group for the id, optional). */
export function extractLinks(html: string, base: string, pattern: RegExp): { url: string; id: string | null }[] {
  const seen = new Map<string, string | null>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let abs: string;
    try {
      abs = new URL(m[1].replace(/&amp;/g, '&'), base).toString();
    } catch {
      continue;
    }
    const hit = abs.match(pattern);
    if (hit && !seen.has(abs)) seen.set(abs, hit[1] ?? null);
  }
  return [...seen].map(([url, id]) => ({ url, id }));
}
