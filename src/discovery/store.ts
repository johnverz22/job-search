import { pool } from '../db.js';
import { connectors } from '../connectors/index.js';
import { HttpError } from '../http.js';
import type { Platform } from '../types.js';
import type { Candidate } from './patterns.js';

/** Insert unseen candidates as disabled + unvalidated. Returns how many were new. */
export async function upsertCandidates(cands: Candidate[], via: string): Promise<number> {
  let added = 0;
  for (let i = 0; i < cands.length; i += 5000) {
    const chunk = cands.slice(i, i + 5000);
    const r = await pool.query(
      `INSERT INTO sources (platform, company_slug, enabled, validation_status, discovered_via, discovered_at)
       SELECT p, s, FALSE, 'unvalidated', $3, now() FROM unnest($1::text[], $2::text[]) AS t(p, s)
       ON CONFLICT (platform, company_slug) DO NOTHING`,
      [chunk.map((c) => c.platform), chunk.map((c) => c.slug), via],
    );
    added += r.rowCount ?? 0;
  }
  return added;
}

const MAX_VALIDATION_ATTEMPTS = 3;

/** Probe a batch of unvalidated sources; enable the ones that return a well-formed board (even with 0 jobs). */
export async function validateBatch(limit: number, log = console.log) {
  const { rows } = await pool.query(
    `SELECT id, platform, company_slug, validation_attempts FROM sources WHERE validation_status='unvalidated' ORDER BY id LIMIT $1`,
    [limit],
  );
  const stats = { valid: 0, invalid: 0, retry: 0 };
  for (const s of rows as { id: number; platform: Platform; company_slug: string; validation_attempts: number }[]) {
    try {
      const jobs = await connectors[s.platform].fetchJobs(s.company_slug);
      await pool.query(`UPDATE sources SET validation_status='valid', enabled=TRUE, jobs_found=$2, last_error=NULL WHERE id=$1`, [s.id, jobs.length]);
      stats.valid++;
      log(`valid   ${s.platform}/${s.company_slug} (${jobs.length} jobs)`);
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 300);
      const permanent = e instanceof HttpError && [400, 401, 403, 404, 410].includes(e.status);
      const attempts = s.validation_attempts + 1;
      const invalid = permanent || attempts >= MAX_VALIDATION_ATTEMPTS;
      await pool.query(`UPDATE sources SET validation_attempts=$2, validation_status=$3, last_error=$4 WHERE id=$1`, [s.id, attempts, invalid ? 'invalid' : 'unvalidated', msg]);
      invalid ? stats.invalid++ : stats.retry++;
      log(`${invalid ? 'invalid' : 'retry  '} ${s.platform}/${s.company_slug}: ${msg}`);
    }
  }
  return stats;
}
