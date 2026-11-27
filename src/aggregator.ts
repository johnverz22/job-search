/** The in-process crawler: keeps every configured source's jobs in memory and refreshes them in the background. */
import { connectors as liveConnectors } from './connectors/index.js';
import { HttpError } from './http.js';
import { jobKey, toRecord, type Aggregator, type JobRecord, type SourceEntry, type SourceState } from './model.js';
import { readSnapshot, writeSnapshot } from './snapshot.js';
import type { Connector, Platform, PreviousJob } from './types.js';

const HOUR = 3600_000;
const MAX_BACKOFF_MS = 6 * HOUR;
const INVALID_RETRY_MS = 24 * HOUR;
const PERMANENT_STATUSES = [400, 401, 403, 404, 410];
const SNAPSHOT_EVERY_MS = 30_000;

export interface AggregatorOptions {
  connectors?: Record<Platform, Connector>;
  concurrency?: number;
  refreshMs?: number;
  staleMs?: number;
  snapshotFile?: string;
  /** How long stop() waits for crawls in progress. */
  stopTimeoutMs?: number;
  random?: () => number;
  log?: (message: string) => void;
}

const positive = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): AggregatorOptions {
  return {
    concurrency: Math.max(1, Math.floor(positive(env.CRAWL_CONCURRENCY, 4))),
    refreshMs: positive(env.REFRESH_MINUTES, 60) * 60_000,
    staleMs: positive(env.STALE_HOURS, 72) * HOUR,
    snapshotFile: env.SNAPSHOT_FILE || undefined,
  };
}

/** Delay before retrying a failing source: doubles per failure, capped at 6h, never shorter than the normal interval. */
export const backoffMs = (refreshMs: number, failures: number) =>
  Math.max(refreshMs, Math.min(refreshMs * 2 ** Math.min(failures, 20), MAX_BACKOFF_MS));

interface Source {
  entry: SourceEntry;
  state: SourceState;
  records: JobRecord[];
  due: number;
  attempted: boolean;
  running: boolean;
}

export function createAggregator(entries: readonly SourceEntry[], opts: AggregatorOptions = {}): Aggregator {
  const {
    connectors = liveConnectors, concurrency = 4, refreshMs = HOUR, staleMs = 72 * HOUR, snapshotFile,
    stopTimeoutMs = 10_000, random = Math.random, log = console.log,
  } = opts;

  const sources: Source[] = entries.map((entry) => ({
    entry,
    records: [],
    due: 0,
    attempted: false,
    running: false,
    state: {
      platform: entry.platform, slug: entry.slug, status: 'pending', jobs: 0, lastAttemptAt: null, lastOkAt: null, lastError: null,
      failures: 0, nextDueAt: new Date().toISOString(),
    },
  }));

  let all: readonly JobRecord[] = [];
  let byId = new Map<string, JobRecord>();
  let version = 0;
  let started = false;
  let stopping = false;
  let closed = false;
  let boot: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  const inflight = new Set<Promise<void>>();

  function publish() {
    const next = new Map<string, JobRecord>();
    for (const s of sources) for (const r of s.records) next.set(r.id, r);
    byId = next;
    all = [...next.values()];
    version++;
  }

  function schedule(s: Source, delayMs: number) {
    s.due = Date.now() + delayMs;
    s.state.nextDueAt = new Date(s.due).toISOString();
  }

  // --- snapshot ------------------------------------------------------------------------------------------------------
  let dirty = false;
  let saveTimer: NodeJS.Timeout | undefined;
  let saving: Promise<void> = Promise.resolve();
  let lastSave = 0;

  function save(): Promise<void> {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    saving = saving.then(async () => {
      if (!snapshotFile || !dirty) return;
      dirty = false;
      lastSave = Date.now();
      try {
        await writeSnapshot(snapshotFile, sources.map((s) => ({ ...s.entry, lastOkAt: s.state.lastOkAt, records: s.records })));
      } catch (e) {
        dirty = true;
        log(`snapshot: write failed: ${(e as Error).message}`);
      }
    });
    return saving;
  }

  function changed() {
    publish();
    if (!snapshotFile) return;
    dirty = true;
    saveTimer ??= setTimeout(() => void save(), Math.max(0, lastSave + SNAPSHOT_EVERY_MS - Date.now()));
  }

  async function restore() {
    if (!snapshotFile) return;
    try {
      const saved = await readSnapshot(snapshotFile);
      if (!saved) return;
      const bySource = new Map(saved.map((x) => [`${x.platform}/${x.slug}`, x]));
      let jobs = 0;
      for (const s of sources) {
        const hit = bySource.get(`${s.entry.platform}/${s.entry.slug}`);
        if (!hit) continue; // sources removed from the list are not restored
        s.records = hit.records;
        s.state.jobs = hit.records.length;
        s.state.lastOkAt = hit.lastOkAt;
        jobs += hit.records.length;
      }
      publish();
      log(`snapshot: restored ${jobs} jobs`);
    } catch (e) {
      log(`snapshot: ignoring unreadable file ${snapshotFile}: ${(e as Error).message}`);
    }
  }

  // --- crawling ------------------------------------------------------------------------------------------------------
  async function crawl(s: Source) {
    const { platform, slug } = s.entry;
    const tag = `${platform}/${slug}`;
    s.state.lastAttemptAt = new Date().toISOString();
    try {
      const connector = connectors[platform];
      const known = new Map(s.records.map((r) => [r.key, r]));
      const previous: Map<string, PreviousJob> | undefined = connector.cachesDetail
        ? new Map(s.records.map((r) => [r.externalId, { raw: r.raw, detailFetchedAt: r.detailFetchedAt }]))
        : undefined;
      const jobs = await connector.fetchJobs(slug, { previous });
      if (closed) return;
      const now = new Date();
      const records = new Map<string, JobRecord>();
      for (const j of jobs) {
        const next = toRecord(j, known.get(jobKey(j.platform, j.companySlug, j.externalId)), now);
        // `raw` only feeds the detail cache; holding it for other connectors would waste most of the memory budget.
        if (!connector.cachesDetail) next.raw = null;
        records.set(next.id, next);
      }
      s.records = [...records.values()];
      Object.assign(s.state, { status: 'ok', jobs: s.records.length, lastOkAt: now.toISOString(), lastError: null, failures: 0 });
      schedule(s, Math.round(refreshMs * (0.9 + random() * 0.2)));
      s.attempted = true;
      changed();
      log(`crawl ok   ${tag}: ${s.records.length} jobs`);
    } catch (e) {
      if (closed) return;
      const permanent = e instanceof HttpError && PERMANENT_STATUSES.includes(e.status);
      const message = String((e as Error)?.message ?? e).slice(0, 500);
      s.state.failures++;
      s.state.status = permanent ? 'invalid' : 'failing';
      s.state.lastError = message;
      schedule(s, permanent ? INVALID_RETRY_MS : backoffMs(refreshMs, s.state.failures));
      s.attempted = true;
      const lastOk = s.state.lastOkAt ? Date.parse(s.state.lastOkAt) : NaN;
      if (s.records.length && !(Date.now() - lastOk < staleMs)) {
        log(`crawl      ${tag}: no success for too long, dropping its ${s.records.length} jobs`);
        s.records = [];
        s.state.jobs = 0;
        changed();
      }
      log(`crawl fail ${tag}: ${message}`);
    }
  }

  /** Starts as many due crawls as there are free slots, then sleeps until the next source becomes due. */
  function pump() {
    clearTimeout(timer);
    if (stopping) return;
    const now = Date.now();
    const waiting = sources.filter((s) => !s.running).sort((a, b) => a.due - b.due);
    for (const s of waiting) {
      if (inflight.size >= concurrency) return; // a finishing crawl pumps again
      if (s.due > now) {
        timer = setTimeout(pump, s.due - now);
        return;
      }
      s.running = true;
      const p: Promise<void> = crawl(s)
        .catch((e) => log(`crawl: unexpected error: ${(e as Error).message}`))
        .finally(() => {
          s.running = false;
          inflight.delete(p);
          pump();
        });
      inflight.add(p);
    }
  }

  return {
    all: () => all,
    get: (id) => byId.get(id),
    version: () => version,
    states: () => sources.map((s) => ({ ...s.state })),
    progress() {
      const done = sources.filter((s) => s.attempted).length;
      return { ready: done === sources.length, total: sources.length, done };
    },
    start() {
      if (started) return;
      started = true;
      boot = restore().then(pump);
    },
    async stop() {
      stopping = true;
      clearTimeout(timer);
      await boot;
      let timeout: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.allSettled([...inflight]),
        new Promise((resolve) => { timeout = setTimeout(resolve, stopTimeoutMs); }),
      ]);
      clearTimeout(timeout);
      closed = true;
      await save();
    },
  };
}
