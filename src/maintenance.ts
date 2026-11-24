import { pool } from './db.js';

const STALE_DAYS = Number(process.env.STALE_DAYS ?? 7);
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 90);

/**
 * Jobs from sources that have not crawled successfully for STALE_DAYS are closed (we can no longer vouch for them).
 * Their snapshot_hash is cleared so that a later "unchanged" crawl re-opens them through a full save, not a touch.
 */
export async function closeStaleJobs(days = STALE_DAYS) {
  const stale = await pool.query(
    `UPDATE sources SET snapshot_hash=NULL
     WHERE (last_success IS NULL OR last_success < now() - make_interval(days => $1))
       AND EXISTS (SELECT 1 FROM jobs j WHERE j.platform=sources.platform AND j.company_slug=sources.company_slug AND j.status='open')
     RETURNING platform, company_slug`,
    [days],
  );
  if (!stale.rowCount) return 0;
  const r = await pool.query(
    `UPDATE jobs SET status='closed'
     WHERE status='open' AND (platform, company_slug) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
    [stale.rows.map((x) => x.platform), stale.rows.map((x) => x.company_slug)],
  );
  return r.rowCount ?? 0;
}

/** Hard-delete jobs that have been closed for RETENTION_DAYS. */
export async function purgeClosedJobs(days = RETENTION_DAYS) {
  const r = await pool.query(`DELETE FROM jobs WHERE status='closed' AND last_seen < now() - make_interval(days => $1)`, [days]);
  return r.rowCount ?? 0;
}

export async function runMaintenance(log = console.log) {
  const closed = await closeStaleJobs();
  const purged = await purgeClosedJobs();
  log(`maintenance: closed ${closed} stale jobs, purged ${purged} old closed jobs`);
}
