import { createHash } from 'node:crypto';
import { isJobId } from './model.js';
import { PLATFORMS } from './types.js';

/** Parsing and validation for GET /jobs, and the opaque paging cursor. Matching and ordering live in src/search.ts. */

export class QueryError extends Error {}

export const SORTS = ['relevance', 'newest'] as const;
export type Sort = (typeof SORTS)[number];

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;
export const MAX_OFFSET = 10_000;
const MAX_Q_LENGTH = 200;
const MAX_LIST_ITEMS = 20;

/** Single source of truth for the accepted query parameters; src/openapi.ts renders the docs from it. */
export const JOB_PARAMS = {
  q: { type: 'string', description: `Text search: all words must match (word prefixes, light stemming); supports "quoted phrase", -excluded and or. Max ${MAX_Q_LENGTH} chars. Matches title, department, company and description.` },
  sort: { type: 'string', enum: [...SORTS], description: 'relevance (default when q is set; best match first) or newest (default otherwise). relevance requires q.' },
  limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Page size, default ${DEFAULT_LIMIT}.` },
  cursor: { type: 'string', description: 'Opaque next_cursor from a previous response. Only valid with the same filters and sort that produced it.' },
  offset: { type: 'integer', minimum: 0, maximum: MAX_OFFSET, description: 'Deprecated; prefer cursor. Cannot be combined with cursor.' },
  platform: { type: 'string', description: `ATS platform; repeat or comma-separate for several. One of: ${PLATFORMS.join(', ')}.` },
  company: { type: 'string', description: 'Exact company slug; repeat or comma-separate for several.' },
  department: { type: 'string', description: 'Case-insensitive substring of the department.' },
  location: { type: 'string', description: 'Case-insensitive substring matched against any of the job\'s locations.' },
  employment_type: { type: 'string', description: 'Case-insensitive exact match on the platform\'s employment type label (labels are not normalized across platforms); repeat or comma-separate for several.' },
  seniority: { type: 'string', description: 'Case-insensitive exact match on the platform\'s seniority label (not normalized across platforms); repeat or comma-separate for several.' },
  remote: { type: 'boolean', description: 'true: remote jobs; false: jobs known to be on-site/hybrid. Jobs with unknown remote status match neither.' },
  min_salary: { type: 'number', description: 'Jobs whose advertised range reaches at least this amount (top of range >= value). Requires salary_currency.' },
  max_salary: { type: 'number', description: 'Jobs whose advertised range starts at or below this amount (bottom of range <= value). Requires salary_currency.' },
  salary_currency: { type: 'string', description: 'ISO currency code, e.g. USD. Case-insensitive.' },
  has_salary: { type: 'boolean', description: 'true: only jobs with a structured salary; false: only jobs without one.' },
  posted_after: { type: 'string', description: 'ISO date or datetime. Uses posted date, or first-seen date when the posting has none.' },
  posted_within_days: { type: 'integer', minimum: 1, maximum: 365, description: 'Only jobs posted (or first seen) in the last N days.' },
  distinct: { type: 'boolean', description: 'true: collapse duplicate postings (same company, title and locations) to the best one.' },
} as const;

export type JobParamName = keyof typeof JOB_PARAMS;

export interface JobsQuery {
  q?: string;
  sort: Sort;
  limit: number;
  offset?: number;
  cursor?: CursorPayload;
  platform?: string[];
  company?: string[];
  department?: string;
  location?: string;
  employmentType?: string[];
  seniority?: string[];
  remote?: boolean;
  minSalary?: number;
  maxSalary?: number;
  salaryCurrency?: string;
  hasSalary?: boolean;
  postedAfter?: string; // ISO instant
  postedWithinDays?: number;
  distinct: boolean;
}

export interface CursorPayload {
  v: 2;
  s: Sort;
  f: string; // fingerprint of the filters the cursor was issued for
  t: number; // sortTs of the last row
  r?: number; // relevance of the last row (relevance sort only)
  i: string; // job id
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------------

type Raw = Record<string, unknown>;

function one(raw: Raw, name: string): string | undefined {
  const v = raw[name];
  if (v === undefined) return undefined;
  if (Array.isArray(v)) throw new QueryError(`${name} was given more than once`);
  if (typeof v !== 'string') throw new QueryError(`${name} must be a string`);
  return v.trim() === '' ? undefined : v.trim();
}

function list(raw: Raw, name: string): string[] | undefined {
  const v = raw[name];
  if (v === undefined) return undefined;
  const parts = (Array.isArray(v) ? v : [v]).flatMap((x) => {
    if (typeof x !== 'string') throw new QueryError(`${name} must be a string`);
    return x.split(',');
  }).map((x) => x.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length > MAX_LIST_ITEMS) throw new QueryError(`${name} accepts at most ${MAX_LIST_ITEMS} values`);
  return [...new Set(parts)];
}

function bool(raw: Raw, name: string): boolean | undefined {
  const v = one(raw, name);
  if (v === undefined) return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new QueryError(`${name} must be "true" or "false"`);
}

function int(raw: Raw, name: string, min: number, max: number): number | undefined {
  const v = one(raw, name);
  if (v === undefined) return undefined;
  if (!/^\d{1,9}$/.test(v)) throw new QueryError(`${name} must be an integer between ${min} and ${max}`);
  const n = Number(v);
  if (n < min || n > max) throw new QueryError(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

function num(raw: Raw, name: string): number | undefined {
  const v = one(raw, name);
  if (v === undefined) return undefined;
  if (!/^\d{1,12}(\.\d{1,4})?$/.test(v)) throw new QueryError(`${name} must be a non-negative number`);
  return Number(v);
}

export function parseJobsQuery(raw: Raw): JobsQuery {
  const unknown = Object.keys(raw).filter((k) => !(k in JOB_PARAMS));
  if (unknown.length) throw new QueryError(`unknown parameter(s): ${unknown.join(', ')}`);

  const q = one(raw, 'q');
  if (q && q.length > MAX_Q_LENGTH) throw new QueryError(`q must be at most ${MAX_Q_LENGTH} characters`);

  const sortRaw = one(raw, 'sort');
  if (sortRaw !== undefined && !(SORTS as readonly string[]).includes(sortRaw)) throw new QueryError(`sort must be one of: ${SORTS.join(', ')}`);
  if (sortRaw === 'relevance' && !q) throw new QueryError('sort=relevance requires q');
  const sort: Sort = (sortRaw as Sort | undefined) ?? (q ? 'relevance' : 'newest');

  const platform = list(raw, 'platform');
  const badPlatform = platform?.filter((p) => !(PLATFORMS as readonly string[]).includes(p));
  if (badPlatform?.length) throw new QueryError(`unknown platform: ${badPlatform.join(', ')}`);

  const minSalary = num(raw, 'min_salary');
  const maxSalary = num(raw, 'max_salary');
  const currencyRaw = one(raw, 'salary_currency');
  if (currencyRaw !== undefined && !/^[A-Za-z]{3}$/.test(currencyRaw)) throw new QueryError('salary_currency must be a 3-letter ISO code');
  const salaryCurrency = currencyRaw?.toUpperCase();
  if ((minSalary !== undefined || maxSalary !== undefined) && !salaryCurrency) {
    throw new QueryError('min_salary/max_salary require salary_currency (amounts in different currencies are not comparable)');
  }
  if (minSalary !== undefined && maxSalary !== undefined && minSalary > maxSalary) throw new QueryError('min_salary must not exceed max_salary');

  let postedAfter: string | undefined;
  const pa = one(raw, 'posted_after');
  if (pa !== undefined) {
    const t = /^\d{4}-\d{2}-\d{2}([T ].+)?$/.test(pa) ? Date.parse(pa) : NaN;
    if (Number.isNaN(t)) throw new QueryError('posted_after must be an ISO date or datetime');
    postedAfter = new Date(t).toISOString();
  }

  const offset = int(raw, 'offset', 0, MAX_OFFSET);
  const cursorRaw = one(raw, 'cursor');
  if (offset !== undefined && cursorRaw !== undefined) throw new QueryError('offset cannot be combined with cursor');

  const query: JobsQuery = {
    q,
    sort,
    limit: int(raw, 'limit', 1, MAX_LIMIT) ?? DEFAULT_LIMIT,
    offset,
    platform,
    company: list(raw, 'company'),
    department: one(raw, 'department'),
    location: one(raw, 'location'),
    employmentType: list(raw, 'employment_type'),
    seniority: list(raw, 'seniority'),
    remote: bool(raw, 'remote'),
    minSalary,
    maxSalary,
    salaryCurrency,
    hasSalary: bool(raw, 'has_salary'),
    postedAfter,
    postedWithinDays: int(raw, 'posted_within_days', 1, 365),
    distinct: bool(raw, 'distinct') ?? false,
  };

  if (cursorRaw !== undefined) {
    const cursor = decodeCursor(cursorRaw);
    if (cursor.s !== query.sort) throw new QueryError('cursor was issued for a different sort');
    if (cursor.f !== filterFingerprint(query)) throw new QueryError('cursor was issued for different filters; start again without a cursor');
    query.cursor = cursor;
  }
  return query;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cursors
// ---------------------------------------------------------------------------------------------------------------------

/** Identifies the filter set (not paging) so a cursor can't silently be replayed against a different query. */
export function filterFingerprint(q: JobsQuery): string {
  const { limit: _l, offset: _o, cursor: _c, ...filters } = q;
  const canonical = Object.keys(filters).sort().map((k) => [k, (filters as Record<string, unknown>)[k]]).filter(([, v]) => v !== undefined);
  return createHash('sha1').update(JSON.stringify(canonical)).digest('hex').slice(0, 12);
}

export const encodeCursor = (c: CursorPayload): string => Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor(s: string): CursorPayload {
  const bad = () => new QueryError('invalid cursor');
  let p: unknown;
  try {
    p = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (!p || typeof p !== 'object') throw bad();
  const c = p as Record<string, unknown>;
  if (c.v !== 2 || !(SORTS as readonly unknown[]).includes(c.s)) throw bad();
  if (typeof c.f !== 'string' || typeof c.t !== 'number' || !Number.isFinite(c.t)) throw bad();
  if (typeof c.i !== 'string' || !isJobId(c.i)) throw bad();
  if (c.s === 'relevance' ? typeof c.r !== 'number' || !Number.isFinite(c.r) : c.r !== undefined) throw bad();
  return c as unknown as CursorPayload;
}
