import { connectors } from './connectors/index.js';
import { pool } from './db.js';
import { saveSnapshot } from './store.js';
import type { Platform } from './types.js';

const MAX_FAILURES = Number(process.env.MAX_FAILURES ?? 5);
const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 15 * 60 * 1000);
const once = process.argv.includes('--once');

async function runOnce() {
  const { rows } = await pool.query(
    `SELECT platform, company_slug FROM sources WHERE enabled AND failure_count < $1 ORDER BY last_success NULLS FIRST`,
    [MAX_FAILURES],
  );
  console.log(`worker: ${rows.length} sources due`);
  for (const s of rows as { platform: Platform; company_slug: string }[]) {
    const connector = connectors[s.platform];
    if (!connector) continue;
    try {
      const jobs = await connector.fetchJobs(s.company_slug);
      await saveSnapshot(s.platform, s.company_slug, jobs);
      await pool.query(
        `UPDATE sources SET last_seen=now(), last_success=now(), failure_count=0, last_error=NULL WHERE platform=$1 AND company_slug=$2`,
        [s.platform, s.company_slug],
      );
      console.log(`ok   ${s.platform}/${s.company_slug}: ${jobs.length} jobs`);
    } catch (e) {
      await pool.query(
        `UPDATE sources SET last_seen=now(), failure_count=failure_count+1, last_error=$3 WHERE platform=$1 AND company_slug=$2`,
        [s.platform, s.company_slug, String((e as Error).message).slice(0, 500)],
      );
      console.error(`fail ${s.platform}/${s.company_slug}: ${(e as Error).message}`);
    }
  }
}

async function main() {
  do {
    await runOnce();
    if (once) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  } while (true);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
