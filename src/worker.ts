import { connectors } from './connectors/index.js';
import { pool } from './db.js';
import { snapshotHash } from './hash.js';
import { HttpError } from './http.js';
import { runMaintenance } from './maintenance.js';
import { disableReason, nextDelayMs } from './schedule.js';
import { loadPrevious, saveSnapshot, touchSnapshot } from './store.js';
import type { Platform } from './types.js';

const BASE_MS = Number(process.env.WORKER_INTERVAL_MS ?? 15 * 60 * 1000);
const MAX_MS = Number(process.env.MAX_INTERVAL_HOURS ?? 24) * 3600_000;
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 4));
const MAX_FAILURES = Number(process.env.MAX_FAILURES ?? 12);
const LEASE_MIN = Number(process.env.LEASE_MINUTES ?? 30);
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
const MAINT_EVERY_MS = 3600_000;
const once = process.argv.includes('--once');

interface Claimed {
  id: number;
  platform: Platform;
  company_slug: string;
  unchanged_count: number;
  failure_count: number;
  permanent_failures: number;
  snapshot_hash: string | null;
}

/**
 * Claim due sources. The lease pushes next_run_at forward, so a crashed worker's sources become due again
 * after LEASE_MIN, and several workers can run side by side (SKIP LOCKED).
 */
async function claim(n: number): Promise<Claimed[]> {
  const { rows } = await pool.query(
    `UPDATE sources SET next_run_at = now() + make_interval(mins => $2)
     WHERE id IN (SELECT id FROM sources WHERE enabled AND next_run_at <= now() ORDER BY next_run_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id, platform, company_slug, unchanged_count, failure_count, permanent_failures, snapshot_hash`,
    [n, LEASE_MIN],
  );
  return rows;
}

async function runSource(s: Claimed) {
  const tag = `${s.platform}/${s.company_slug}`;
  try {
    const connector = connectors[s.platform];
    const previous = connector.cachesDetail ? await loadPrevious(s.platform, s.company_slug) : undefined;
    const jobs = await connector.fetchJobs(s.company_slug, { previous });
    const hash = snapshotHash(jobs);
    const changed = hash !== s.snapshot_hash;
    if (changed) await saveSnapshot(s.platform, s.company_slug, jobs);
    else await touchSnapshot(s.platform, s.company_slug);
    const unchanged = changed ? 0 : s.unchanged_count + 1;
    const delay = nextDelayMs({ baseMs: BASE_MS, maxMs: MAX_MS, unchangedCount: unchanged, failureCount: 0 });
    await pool.query(
      `UPDATE sources SET last_seen=now(), last_success=now(), failure_count=0, permanent_failures=0, last_error=NULL,
         snapshot_hash=$2, unchanged_count=$3, last_job_count=$4, next_run_at = now() + make_interval(secs => $5)
       WHERE id=$1`,
      [s.id, hash, unchanged, jobs.length, delay / 1000],
    );
    console.log(`ok   ${tag}: ${jobs.length} jobs ${changed ? '(changed)' : '(unchanged)'}, next in ${Math.round(delay / 60000)}m`);
  } catch (e) {
    const permanent = e instanceof HttpError && (e.status === 404 || e.status === 410);
    const failures = s.failure_count + 1;
    const permanents = permanent ? s.permanent_failures + 1 : 0;
    const reason = disableReason({ failureCount: failures, permanentFailures: permanents, maxFailures: MAX_FAILURES });
    const delay = nextDelayMs({ baseMs: BASE_MS, unchangedCount: 0, failureCount: failures });
    await pool.query(
      `UPDATE sources SET last_seen=now(), failure_count=$2, permanent_failures=$3, last_error=$4,
         enabled=$5, disabled_reason=$6, next_run_at = now() + make_interval(secs => $7)
       WHERE id=$1`,
      [s.id, failures, permanents, String((e as Error).message).slice(0, 500), reason === null, reason, delay / 1000],
    );
    console.error(`fail ${tag}: ${(e as Error).message}${reason ? ` -> disabled (${reason})` : `, retry in ${Math.round(delay / 60000)}m`}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { console.log(`${sig}: finishing in-flight crawls`); stopping = true; });

  const inflight = new Set<Promise<void>>();
  let lastMaintenance = 0;
  console.log(`worker: concurrency=${CONCURRENCY} base=${BASE_MS / 60000}m max=${MAX_MS / 3600000}h${once ? ' (once)' : ''}`);

  while (!stopping) {
    let claimed = 0;
    const free = CONCURRENCY - inflight.size;
    if (free > 0) {
      const rows = await claim(free);
      claimed = rows.length;
      for (const r of rows) {
        const p: Promise<void> = runSource(r).catch((e) => console.error('unexpected', e)).finally(() => inflight.delete(p));
        inflight.add(p);
      }
    }
    if (once && claimed === 0 && inflight.size === 0) break;
    if (!once && Date.now() - lastMaintenance > MAINT_EVERY_MS) {
      await runMaintenance().catch((e) => console.error('maintenance failed', e));
      lastMaintenance = Date.now();
    }
    await (claimed > 0 ? sleep(200) : inflight.size >= CONCURRENCY ? Promise.race(inflight) : sleep(once ? 500 : POLL_MS));
  }
  await Promise.allSettled(inflight);
  if (once) await runMaintenance().catch((e) => console.error('maintenance failed', e));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
