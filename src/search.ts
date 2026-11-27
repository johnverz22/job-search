/**
 * In-memory search over JobRecords: filtering, text matching, ranking and cursor paging. Pure functions; the semantics are
 * described in docs/planning/07-monolith-plan.md section 3.5.
 */
import type { JobRecord } from './model.js';
import { encodeCursor, filterFingerprint, type JobsQuery } from './query.js';

// ---------------------------------------------------------------------------------------------------------------------
// Query text
// ---------------------------------------------------------------------------------------------------------------------

/** English stop words (the snowball list Postgres used). */
export const STOP_WORDS = new Set(
  ('i me my myself we our ours ourselves you your yours yourself yourselves he him his himself she her hers herself it its itself '
    + 'they them their theirs themselves what which who whom this that these those am is are was were be been being have has had '
    + 'having do does did doing a an the and but if or because as until while of at by for with about against between into through '
    + 'during before after above below to from up down in out on off over under again further then once here there when where why '
    + 'how all any both each few more most other some such no nor not only own same so than too very s t can will just don should now').split(' '),
);

/** Light suffix stripping. The result is always a prefix of the word, so prefix matching against raw text still works. */
export function stem(word: string): string {
  const cut = (n: number) => word.slice(0, -n);
  for (const [suffix, n] of [['ing', 3], ['ed', 2]] as const) {
    if (word.endsWith(suffix) && word.length - n >= 3) {
      const base = cut(n);
      return /([bdgmnprt])\1$/.test(base) ? base.slice(0, -1) : base; // running -> run
    }
  }
  if (/(ss|x|z|ch|sh)es$/.test(word) && word.length >= 5) return cut(2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length >= 4) return cut(1);
  return word;
}

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export type Term = { kind: 'word'; text: string } | { kind: 'phrase'; text: string };
export interface TextQuery {
  /** OR of AND-groups: a record matches if every term of at least one group matches. */
  groups: Term[][];
  /** A record is dropped if every term of any one of these matches. */
  excluded: Term[][];
}

export function parseText(q: string): TextQuery {
  const groups: Term[][] = [];
  const excluded: Term[][] = [];
  let current: Term[] = [];
  for (const m of q.toLowerCase().matchAll(/(-?)"([^"]*)"?|(\S+)/g)) {
    const [, phraseMinus, phrase, bare] = m;
    if (bare === 'or') {
      if (current.length) groups.push(current);
      current = [];
      continue;
    }
    let negated: boolean;
    let terms: Term[];
    if (phrase !== undefined) {
      negated = phraseMinus === '-';
      const text = phrase.replace(/\s+/g, ' ').trim();
      terms = words(text).length ? [{ kind: 'phrase', text }] : [];
    } else {
      negated = bare.startsWith('-');
      terms = words(bare).filter((w) => !STOP_WORDS.has(w)).map((w) => ({ kind: 'word', text: stem(w) }));
    }
    if (!terms.length) continue;
    if (negated) excluded.push(terms);
    else current.push(...terms);
  }
  if (current.length) groups.push(current);
  return { groups, excluded };
}

// ---------------------------------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------------------------------

const BODY_HIT_CAP = 5;
const TITLE_PHRASE_BONUS = 3;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const isWordAt = (s: string, i: number) => {
  const c = s.charCodeAt(i);
  if (c < 128) return (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || (c >= 65 && c <= 90);
  return WORD_CHAR.test(s.charAt(i));
};

/** Occurrences of a term in already-lowercased text, up to `cap`. */
function hits(text: string, term: Term, cap: number): number {
  const needle = term.text;
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1 && n < cap; i = text.indexOf(needle, i + 1)) {
    if (term.kind === 'word') {
      if (i > 0 && isWordAt(text, i - 1)) continue; // must start a word
      // One- and two-letter terms ("c", "go", "qa") must be whole words, or they would match nearly everything.
      if (needle.length <= 2 && i + needle.length < text.length && isWordAt(text, i + needle.length)) continue;
    }
    n++;
  }
  return n;
}

const matches = (r: JobRecord, t: Term) =>
  hits(r.search.title, t, 1) > 0 || hits(r.search.department, t, 1) > 0 || hits(r.search.company, t, 1) > 0 || hits(r.search.body, t, 1) > 0;

function score(r: JobRecord, t: Term): number {
  const title = hits(r.search.title, t, Infinity);
  const base = 4 * title + 2 * hits(r.search.department, t, Infinity) + 2 * hits(r.search.company, t, Infinity) + hits(r.search.body, t, BODY_HIT_CAP);
  return base + (t.kind === 'phrase' && title > 0 ? TITLE_PHRASE_BONUS : 0);
}

/** Relevance of a record for a parsed query, or null if it does not match. */
export function matchText(r: JobRecord, tq: TextQuery): number | null {
  // A query with nothing left to look for (only stop words or punctuation) matches nothing.
  if (!tq.groups.length && !tq.excluded.length) return null;
  const satisfied = tq.groups.filter((g) => g.every((t) => matches(r, t)));
  if (tq.groups.length && !satisfied.length) return null;
  if (tq.excluded.some((g) => g.every((t) => matches(r, t)))) return null;
  const terms = new Map<string, Term>();
  for (const g of tq.groups) for (const t of g) terms.set(`${t.kind}:${t.text}`, t);
  let total = 0;
  for (const t of terms.values()) total += score(r, t);
  return total;
}

// ---------------------------------------------------------------------------------------------------------------------
// Filtering, ordering, paging
// ---------------------------------------------------------------------------------------------------------------------

function filterFor(q: JobsQuery, now: number): (r: JobRecord) => boolean {
  const lowerSet = (v?: string[]) => (v ? new Set(v.map((s) => s.toLowerCase())) : null);
  const platform = q.platform ? new Set<string>(q.platform) : null;
  const company = q.company ? new Set(q.company) : null;
  const department = q.department?.toLowerCase();
  const location = q.location?.toLowerCase();
  const employment = lowerSet(q.employmentType);
  const seniority = lowerSet(q.seniority);
  const after = Math.max(
    q.postedAfter ? Date.parse(q.postedAfter) : -Infinity,
    q.postedWithinDays ? now - q.postedWithinDays * 86_400_000 : -Infinity,
  );
  return (r) => {
    if (platform && !platform.has(r.platform)) return false;
    if (company && !company.has(r.companySlug)) return false;
    if (department !== undefined && !(r.department !== null && r.department.toLowerCase().includes(department))) return false;
    if (location !== undefined && !r.locations.some((l) => l.toLowerCase().includes(location))) return false;
    if (employment && !(r.employmentType !== null && employment.has(r.employmentType.toLowerCase()))) return false;
    if (seniority && !(r.seniority !== null && seniority.has(r.seniority.toLowerCase()))) return false;
    if (q.remote !== undefined && r.remote !== q.remote) return false;
    if (q.hasSalary !== undefined && (r.salaryMin !== null || r.salaryMax !== null) !== q.hasSalary) return false;
    if (q.salaryCurrency && r.salaryCurrency !== q.salaryCurrency) return false;
    if (q.minSalary !== undefined) {
      const top = r.salaryMax ?? r.salaryMin;
      if (top === null || top < q.minSalary) return false;
    }
    if (q.maxSalary !== undefined) {
      const bottom = r.salaryMin ?? r.salaryMax;
      if (bottom === null || bottom > q.maxSalary) return false;
    }
    return r.sortTs >= after;
  };
}

interface Ranked {
  rec: JobRecord;
  rel: number;
}

type Position = { rel: number; ts: number; id: string };
/** Negative if `a` sorts before `b`: relevance desc, sortTs desc, id desc. `rel` is 0 for every row under "newest". */
const order = (a: Position, b: Position) => b.rel - a.rel || b.ts - a.ts || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Newest-first view of a record array, computed once per published array (arrays are replaced, never mutated). */
const newestCache = new WeakMap<readonly JobRecord[], readonly JobRecord[]>();
function newestFirst(all: readonly JobRecord[]): readonly JobRecord[] {
  let sorted = newestCache.get(all);
  if (!sorted) {
    sorted = [...all].sort((a, b) => b.sortTs - a.sortTs || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    newestCache.set(all, sorted);
  }
  return sorted;
}

export interface ListRow {
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

export function toListRow(r: JobRecord, relevance?: number): ListRow {
  return {
    id: r.id,
    platform: r.platform,
    company_slug: r.companySlug,
    title: r.title,
    locations: r.locations,
    remote: r.remote,
    department: r.department,
    employment_type: r.employmentType,
    seniority: r.seniority,
    salary_min: r.salaryMin === null ? null : String(r.salaryMin),
    salary_max: r.salaryMax === null ? null : String(r.salaryMax),
    salary_currency: r.salaryCurrency,
    salary_text: r.salaryText,
    posted_at: r.postedAt,
    apply_url: r.applyUrl,
    first_seen: r.firstSeen,
    last_seen: r.lastSeen,
    dedupe_key: r.dedupeKey || null,
    ...(relevance !== undefined ? { relevance } : {}),
  };
}

export const toDetailRow = (r: JobRecord) => ({
  ...toListRow(r),
  key: r.key,
  external_id: r.externalId,
  status: 'open' as const,
  description_html: r.descriptionHtml,
});

export interface JobsPage {
  count: number;
  limit: number;
  offset?: number;
  next_cursor: string | null;
  jobs: ListRow[];
}

export interface SearchResult {
  rows: ListRow[];
  nextCursor: string | null;
}

export function searchJobs(all: readonly JobRecord[], q: JobsQuery, now: number = Date.now()): SearchResult {
  const keep = filterFor(q, now);
  const tq = q.q ? parseText(q.q) : null;
  const byRelevance = q.sort === 'relevance';
  const cursor: Position | null = q.cursor ? { rel: q.cursor.r ?? 0, ts: q.cursor.t, id: q.cursor.i } : null;
  const position = (x: Ranked): Position => ({ rel: byRelevance ? x.rel : 0, ts: x.rec.sortTs, id: x.rec.id });
  const wanted = (q.offset ?? 0) + q.limit + 1; // one look-ahead row tells us whether another page exists

  // Candidates arrive newest first. Under "newest" that is the final order, so we can stop as soon as the page is full.
  const seen = new Set<string>();
  const found: Ranked[] = [];
  for (const rec of newestFirst(all)) {
    if (!keep(rec)) continue;
    const rel = tq ? matchText(rec, tq) : 0;
    if (rel === null) continue;
    if (!byRelevance) {
      if (q.distinct) {
        const group = rec.dedupeKey || rec.key;
        if (seen.has(group)) continue;
        seen.add(group); // marked even before the cursor, so a group shown on an earlier page is not shown again
      }
      if (cursor && order(position({ rec, rel }), cursor) <= 0) continue;
      found.push({ rec, rel });
      if (found.length >= wanted) break;
    } else {
      found.push({ rec, rel });
    }
  }

  let rows = found;
  if (byRelevance) {
    rows = found.sort((a, b) => order(position(a), position(b)));
    if (q.distinct) {
      rows = rows.filter(({ rec }) => {
        const group = rec.dedupeKey || rec.key;
        return seen.has(group) ? false : (seen.add(group), true);
      });
    }
    if (cursor) rows = rows.filter((x) => order(position(x), cursor) > 0);
  }

  const start = q.offset ?? 0;
  const page = rows.slice(start, start + q.limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > start + q.limit && last
    ? encodeCursor({ v: 2, s: q.sort, f: filterFingerprint(q), t: last.rec.sortTs, ...(byRelevance ? { r: last.rel } : {}), i: last.rec.id })
    : null;
  return { rows: page.map((x) => toListRow(x.rec, byRelevance ? x.rel : undefined)), nextCursor };
}

export function toPage(q: JobsQuery, { rows, nextCursor }: SearchResult): JobsPage {
  return { count: rows.length, limit: q.limit, ...(q.offset !== undefined ? { offset: q.offset } : {}), next_cursor: nextCursor, jobs: rows };
}
