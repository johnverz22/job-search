import { pool } from './db.js';
import { dedupeKey } from './hash.js';
import type { NormalizedJob, Platform } from './types.js';

export const jobKey = (j: Pick<NormalizedJob, 'platform' | 'companySlug' | 'externalId'>) =>
  `${j.platform}:${j.companySlug}:${j.externalId}`;

/** Upsert a full snapshot for one source and close jobs that disappeared. Call only after a successful fetch. */
export async function saveSnapshot(platform: Platform, slug: string, jobs: NormalizedJob[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const runStart = new Date();
    for (const j of jobs) {
      await client.query(
        `INSERT INTO jobs (key, platform, company_slug, external_id, title, description_html, locations, remote, department,
           employment_type, seniority, salary_min, salary_max, salary_currency, salary_text, posted_at, apply_url, raw, dedupe_key, status, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'open',$20)
         ON CONFLICT (key) DO UPDATE SET title=EXCLUDED.title, description_html=EXCLUDED.description_html, locations=EXCLUDED.locations,
           remote=EXCLUDED.remote, department=EXCLUDED.department, employment_type=EXCLUDED.employment_type, seniority=EXCLUDED.seniority,
           salary_min=EXCLUDED.salary_min, salary_max=EXCLUDED.salary_max, salary_currency=EXCLUDED.salary_currency,
           salary_text=EXCLUDED.salary_text, posted_at=EXCLUDED.posted_at, apply_url=EXCLUDED.apply_url, raw=EXCLUDED.raw,
           dedupe_key=EXCLUDED.dedupe_key, status='open', last_seen=EXCLUDED.last_seen`,
        [jobKey(j), j.platform, j.companySlug, j.externalId, j.title, j.descriptionHtml, j.locations, j.remote, j.department,
         j.employmentType, j.seniority, j.salaryMin, j.salaryMax, j.salaryCurrency, j.salaryText, j.postedAt, j.applyUrl,
         JSON.stringify(j.raw), dedupeKey(j), runStart],
      );
    }
    // An empty successful snapshot is allowed (company has no openings) and closes everything for this source.
    await client.query(
      `UPDATE jobs SET status='closed' WHERE platform=$1 AND company_slug=$2 AND status='open' AND last_seen < $3`,
      [platform, slug, runStart],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Content identical to the last crawl: no rewrite, just refresh last_seen on the open jobs. */
export async function touchSnapshot(platform: Platform, slug: string) {
  await pool.query(`UPDATE jobs SET last_seen=now() WHERE platform=$1 AND company_slug=$2 AND status='open'`, [platform, slug]);
}
