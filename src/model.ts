import { dedupeKey, sha1 } from './hash.js';
import type { NormalizedJob, Platform } from './types.js';

/**
 * Shared contracts of the in-memory (database-free) architecture. See docs/planning/07-monolith-plan.md section 3;
 * change that section in the same commit if you change anything here.
 */

/** One configured board, as listed in data/sources.json. */
export interface SourceEntry {
  platform: Platform;
  slug: string;
  note?: string;
}

export interface JobRecord {
  /** 12 lowercase hex chars: sha1(key).slice(0, 12). Stable across restarts. */
  id: string;
  /** `${platform}:${companySlug}:${externalId}` */
  key: string;
  platform: Platform;
  companySlug: string;
  externalId: string;
  title: string;
  locations: string[];
  remote: boolean | null;
  department: string | null;
  employmentType: string | null;
  seniority: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryText: string | null;
  /** ISO */
  postedAt: string | null;
  applyUrl: string | null;
  /** Capped at MAX_DESCRIPTION_CHARS. */
  descriptionHtml: string | null;
  /** ISO. firstSeen survives re-crawls (and restarts only if a snapshot does). */
  firstSeen: string;
  lastSeen: string;
  dedupeKey: string;
  /** ms epoch of postedAt, else firstSeen: what "newest" sorts by. */
  sortTs: number;
  /** Lowercased text the search engine matches against. `body` is the tag-stripped description, at most MAX_BODY_CHARS. */
  search: { title: string; department: string; company: string; body: string };
  /** Feed the per-job detail cache (ctx.previous). */
  raw: unknown;
  detailFetchedAt: string | null;
}

export type SourceStatus = 'pending' | 'ok' | 'failing' | 'invalid';

export interface SourceState {
  platform: Platform;
  slug: string;
  status: SourceStatus;
  jobs: number;
  lastAttemptAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  failures: number;
  nextDueAt: string;
}

/** What the search engine (S2) and the HTTP layer (S4) need from the crawler (S3). */
export interface Aggregator {
  /** Stable array between mutations; replaced, never mutated in place, so callers may hold it while searching. */
  all(): readonly JobRecord[];
  get(id: string): JobRecord | undefined;
  /** Increments on every change; use as a cache key for derived data (facets, stats). */
  version(): number;
  states(): readonly SourceState[];
  /** ready = every source has been attempted at least once. */
  progress(): { ready: boolean; total: number; done: number };
  start(): void;
  stop(): Promise<void>;
}

export const MAX_DESCRIPTION_CHARS = 100_000;
export const MAX_BODY_CHARS = 20_000;
export const ID_PATTERN = /^[0-9a-f]{12}$/;

export const jobKey = (platform: string, companySlug: string, externalId: string) => `${platform}:${companySlug}:${externalId}`;
export const jobId = (key: string): string => sha1(key).slice(0, 12);
export const isJobId = (s: string): boolean => ID_PATTERN.test(s);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Plain, lowercased text of an HTML description for searching. Not for display, and not a sanitizer. */
export function htmlToSearchText(html: string | null | undefined, max = MAX_BODY_CHARS): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/<[^>]*$/, ' ') // a description cut off mid-tag by the size cap
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, max);
}

const lower = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Normalized connector output -> in-memory record. Pass the previous record for the same key to keep `firstSeen`.
 * `now` is injectable for tests.
 */
export function toRecord(j: NormalizedJob, prev?: JobRecord, now: Date = new Date()): JobRecord {
  const key = jobKey(j.platform, j.companySlug, j.externalId);
  const firstSeen = prev?.firstSeen ?? now.toISOString();
  const postedMs = j.postedAt ? Date.parse(j.postedAt) : NaN;
  const sortTs = Number.isFinite(postedMs) ? postedMs : Date.parse(firstSeen);
  const description = j.descriptionHtml && j.descriptionHtml.length > MAX_DESCRIPTION_CHARS ? j.descriptionHtml.slice(0, MAX_DESCRIPTION_CHARS) : j.descriptionHtml;
  return {
    id: jobId(key),
    key,
    platform: j.platform,
    companySlug: j.companySlug,
    externalId: j.externalId,
    title: j.title,
    locations: j.locations,
    remote: j.remote,
    department: j.department,
    employmentType: j.employmentType,
    seniority: j.seniority,
    salaryMin: j.salaryMin,
    salaryMax: j.salaryMax,
    salaryCurrency: j.salaryCurrency?.toUpperCase() ?? null,
    salaryText: j.salaryText,
    postedAt: Number.isFinite(postedMs) ? new Date(postedMs).toISOString() : null,
    applyUrl: j.applyUrl,
    descriptionHtml: description ?? null,
    firstSeen,
    lastSeen: now.toISOString(),
    dedupeKey: dedupeKey(j),
    sortTs,
    search: {
      title: lower(j.title),
      department: lower(j.department),
      company: lower(j.companySlug.replace(/[-_./]+/g, ' ')),
      body: htmlToSearchText(description),
    },
    raw: j.raw,
    detailFetchedAt: j.detailFetchedAt ?? null,
  };
}
