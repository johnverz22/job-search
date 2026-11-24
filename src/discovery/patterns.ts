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
  lower?: boolean;
  /** Common Crawl CDX `url=` queries that enumerate this platform's pages */
  cc: string[];
  /** crt.sh `q=` queries (subdomain-based platforms only) */
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
];

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
  if (pageUrl && /teamtailor-cdn|assets\.teamtailor\.com|scripts\.teamtailor\.com/i.test(text)) {
    try {
      found.push({ platform: 'teamtailor', slug: new URL(pageUrl).hostname.toLowerCase() });
    } catch { /* ignore */ }
  }
  return dedupe(found);
}

export const discoverablePlatforms = PLATFORMS.filter((p) => RULES.some((r) => r.platform === p));
