import type { PreviousJob } from './types.js';

/** How long a stored job detail is trusted before it is fetched again (descriptions can be edited in place). */
export const DETAIL_TTL_MS = Number(process.env.DETAIL_TTL_HOURS ?? 168) * 3600_000;

/** True if `prev` has a detail that was fetched less than `ttlMs` ago. */
export function isFresh(prev: PreviousJob | undefined, ttlMs = DETAIL_TTL_MS, now = Date.now()): prev is PreviousJob {
  if (!prev?.detailFetchedAt) return false;
  const t = Date.parse(prev.detailFetchedAt);
  return Number.isFinite(t) && now - t < ttlMs;
}
