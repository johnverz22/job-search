const HOUR = 3600_000;
const DAY = 24 * HOUR;

export interface DelayInput {
  baseMs: number;
  maxMs?: number;          // ceiling for quiet healthy sources (default 24h)
  unchangedCount: number;  // consecutive successful crawls with identical content
  failureCount: number;    // consecutive failures (0 on success)
  rand?: () => number;     // injectable for tests
}

/** Next crawl delay. Healthy: backs off x2 per 2 unchanged crawls. Failing: x2 per failure, capped at 7 days. +-10% jitter. */
export function nextDelayMs({ baseMs, maxMs = DAY, unchangedCount, failureCount, rand = Math.random }: DelayInput): number {
  const raw =
    failureCount > 0
      ? Math.min(baseMs * 2 ** Math.min(failureCount, 12), 7 * DAY)
      : Math.min(baseMs * 2 ** Math.min(Math.floor(unchangedCount / 2), 8), maxMs);
  return Math.round(raw * (0.9 + rand() * 0.2));
}

export interface DisableInput {
  failureCount: number;
  permanentFailures: number; // consecutive 404/410 responses
  maxFailures: number;
}

export function disableReason({ failureCount, permanentFailures, maxFailures }: DisableInput): string | null {
  if (permanentFailures >= 3) return 'gone';
  if (failureCount >= maxFailures) return 'too_many_failures';
  return null;
}
