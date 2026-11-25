import { PLATFORMS, type Platform } from '../types.js';

export interface Candidate {
  platform: Platform;
  slug: string;
}

interface Rule {
  platform: Platform;
  /** hostname regex; group 1 = slug (subdomain-based platforms) */
  host?: RegExp;
  /** exact hostname (path-based platforms) */
  hostEq?: string;
  /** path regex; group 1 = slug (path-based platforms) */
  path?: RegExp;
  /** slug is the full hostname (Teamtailor) */
  fullHost?: boolean;
  /** Custom parser for platforms whose slug needs more than the host or one path segment; returns the slug or null. */
  parse?: (u: URL) => string | null;
  lower?: boolean;
  /** Common Crawl CDX `url=` queries that enumerate this platform's pages */
  cc: string[];
  /** crt.sh `q=` queries (only where the hostname alone identifies the board) */
  crt?: string[];
}

export const RULES: Rule[] = [
  { platform: 'recruitee', host: /^([a-z0-9-]+)\.recruitee\.com$/, cc: ['*.recruitee.com'], crt: ['%.recruitee.com'] },
  { platform: 'personio', host: /^([a-z0-9-]+)\.jobs\.personio\.(?:de|com)$/, cc: ['*.jobs.personio.de', '*.jobs.personio.com'], crt: ['%.jobs.personio.de', '%.jobs.personio.com'] },
  { platform: 'bamboohr', host: /^([a-z0-9-]+)\.bamboohr\.com$/, cc: ['*.bamboohr.com'], crt: ['%.bamboohr.com'] },
  { platform: 'pinpoint', host: /^([a-z0-9-]+)\.pinpointhq\.com$/, cc: ['*.pinpointhq.com'], crt: ['%.pinpointhq.com'] },
  { platform: 'jazzhr', host: /^([a-z0-9-]+)\.applytojob\.com$/, cc: ['*.applytojob.com'], crt: ['%.applytojob.com'] },
  { platform: 'teamtailor', host: /^([a-z0-9-]+)\.teamtailor\.com$/, fullHost: true, cc: ['*.teamtailor.com'], crt: ['%.teamtailor.com'] },
  { platform: 'gem', hostEq: 'jobs.gem.com', path: /^\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:\/|$)/, lower: true, cc: ['jobs.gem.com/*'] },
  { platform: 'jobvite', hostEq: 'jobs.jobvite.com', path: /^\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:\/|$)/, cc: ['jobs.jobvite.com/*'] },
  { platform: 'rippling', hostEq: 'ats.rippling.com', path: /^\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:\/|$)/, cc: ['ats.rippling.com/*'] },
  // iCIMS portals: any subdomain is a candidate (careers-acme, jobs-acme, ...); validation filters the non-career ones.
  { platform: 'icims', host: /^([a-z0-9-]+)\.icims\.com$/, cc: ['*.icims.com'], crt: ['%.icims.com'] },
  // Taleo Business Edition: https://{sub}.tbe.taleo.net/{pod}/ats/careers/v2/...?org=ORG&cws=N -> `sub/pod/ORG/N`. Needs the URL, so no crt.sh.
  { platform: 'taleo', parse: parseTaleo, cc: ['*.tbe.taleo.net'] },
  // Workday: https://{tenant}.{wdN}.myworkdayjobs.com/[locale/]{site}/... -> `tenant.wdN/site`. Needs the URL (site), so no crt.sh.
  { platform: 'workday', parse: parseWorkday, cc: ['*.myworkdayjobs.com'] },
  // Y Combinator company job pages (and Work at a Startup company pages, which use the same slugs).
  { platform: 'yc', parse: parseYc, cc: ['www.ycombinator.com/companies/*', 'www.workatastartup.com/companies/*'] },
];

const LOCALE_RE = /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/;
const WORKDAY_SKIP = new Set(['wday', 'cxs', 'job', 'jobs', 'details', 'assets', 'login', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'community']);

/** Exported for tests. Handles /Site, /en-US/Site/job/..., and the API form /wday/cxs/{tenant}/{site}/jobs. */
export function parseWorkday(u: URL): string | null {
  const m = u.hostname.toLowerCase().match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (!m || RESERVED.has(m[1])) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  let site: string | undefined;
  if (segs[0] === 'wday' && segs[1] === 'cxs') site = segs[3];
  else site = segs.find((x, i) => !(i === 0 && LOCALE_RE.test(x)));
  if (!site || WORKDAY_SKIP.has(site.toLowerCase()) || !/^[A-Za-z0-9_-]{1,100}$/.test(site)) return null;
  return `${m[1]}.${m[2]}/${site}`;
}

export function parseTaleo(u: URL): string | null {
  const m = u.hostname.toLowerCase().match(/^([a-z0-9-]+)\.tbe\.taleo\.net$/);
  const pod = u.pathname.match(/^\/([A-Za-z0-9]+)\/ats\/careers\/v2\//)?.[1];
  const org = u.searchParams.get('org');
  const cws = u.searchParams.get('cws');
  if (!m || !slugOk(m[1]) || !pod || !org || !/^[A-Za-z0-9_-]+$/.test(org) || !cws || !/^\d+$/.test(cws)) return null;
  return `${m[1]}/${pod.toLowerCase()}/${org}/${cws}`;
}

export function parseYc(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  const m =
    host === 'www.ycombinator.com' || host === 'ycombinator.com'
      ? u.pathname.match(/^\/companies\/([A-Za-z0-9][A-Za-z0-9-]*)\/jobs(?:\/|$)/) // only job pages: a company page alone does not mean it is hiring
      : host === 'www.workatastartup.com' || host === 'workatastartup.com'
        ? u.pathname.match(/^\/companies\/([A-Za-z0-9][A-Za-z0-9-]*)(?:\/|$)/)
        : null;
  return m && slugOk(m[1]) ? m[1].toLowerCase() : null;
}

/** Subdomains/paths that are vendor infrastructure, not customers. */
export const RESERVED = new Set([
  'www', 'app', 'apps', 'api', 'help', 'support', 'docs', 'developers', 'developer', 'status', 'blog', 'mail', 'smtp', 'cdn', 'static',
  'assets', 'admin', 'login', 'auth', 'sso', 'staging', 'sandbox', 'test', 'demo', 'careers', 'jobs', 'job', 'search', 'embed', 'widget',
  'favicon.ico', 'robots.txt', 'sitemap.xml', 'en', 'de', 'fr', 'es', 'nl', 'partners', 'community', 'learn', 'marketplace', 'integrations',
]);

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

export const slugOk = (s: string) => SLUG_RE.test(s) && !RESERVED.has(s.toLowerCase());

/** Map any URL or bare hostname to a platform + slug, or null. */
export function extractSlug(input: string): Candidate | null {
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  for (const r of RULES) {
    if (r.parse) {
      const slug = r.parse(u);
      if (slug) return { platform: r.platform, slug };
      continue;
    }
    if (r.host) {
      const m = host.match(r.host);
      if (!m || !slugOk(m[1])) continue;
      return { platform: r.platform, slug: r.fullHost ? host : m[1] };
    }
    if (r.hostEq === host && r.path) {
      const m = u.pathname.match(r.path);
      if (!m || !slugOk(m[1])) continue;
      return { platform: r.platform, slug: r.lower ? m[1].toLowerCase() : m[1] };
    }
  }
  return null;
}

export const dedupe = (cs: Candidate[]): Candidate[] => {
  const seen = new Set<string>();
  return cs.filter((c) => {
    const k = `${c.platform}:${c.slug}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
};

/** Scan arbitrary page HTML for links/embeds to supported ATS boards. `pageUrl` enables Teamtailor custom-domain detection. */
export function detectAts(html: string, pageUrl?: string): Candidate[] {
  const text = html.replace(/\\\//g, '/');
  const found: Candidate[] = [];
  for (const m of text.matchAll(/(?:https?:)?\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s"'<>)\\]*)?/gi)) {
    const c = extractSlug(m[0].startsWith('//') ? `https:${m[0]}` : m[0]);
    if (c) found.push(c);
  }
  // Rippling boards embedded on a company's own domain call the board API directly.
  for (const m of text.matchAll(/api\.rippling\.com\/platform\/api\/ats\/v2\/board\/([A-Za-z0-9][A-Za-z0-9_-]*)/gi)) {
    if (slugOk(m[1])) found.push({ platform: 'rippling', slug: m[1] });
  }
  if (pageUrl && /teamtailor-cdn|assets\.teamtailor\.com|scripts\.teamtailor\.com/i.test(text)) {
    try {
      found.push({ platform: 'teamtailor', slug: new URL(pageUrl).hostname.toLowerCase() });
    } catch { /* ignore */ }
  }
  return dedupe(found);
}

export const discoverablePlatforms = PLATFORMS.filter((p) => RULES.some((r) => r.platform === p));
