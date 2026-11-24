import { createHash } from 'node:crypto';
import type { NormalizedJob } from './types.js';

export const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');
const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Same company + same title + same locations => same key (collapses re-posted/duplicated reqs). */
export const dedupeKey = (j: Pick<NormalizedJob, 'platform' | 'companySlug' | 'title' | 'locations'>) =>
  sha1(`${norm(j.companySlug)}|${norm(j.title)}|${[...j.locations].map(norm).sort().join(';')}`);

/** Order-independent fingerprint of a source's content; used to skip DB writes and to back off crawling of quiet sources. */
export function snapshotHash(jobs: NormalizedJob[]): string {
  const lines = jobs
    .map((j) => [j.externalId, norm(j.title), j.locations.map(norm).sort().join(';'), j.remote, j.applyUrl ?? '', j.postedAt ?? '', sha1(j.descriptionHtml ?? '')].join('|'))
    .sort();
  return sha1(lines.join('\n'));
}
