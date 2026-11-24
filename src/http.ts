const lastHit = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const USER_AGENT =
  process.env.CRAWLER_USER_AGENT ?? 'JobSearchBot/0.1 (+https://example.com/bot; contact@example.com)';

export interface FetchOpts {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  minIntervalMs?: number; // per-host politeness delay
  retries?: number;
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(public status: number, public url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

/** Polite fetch: per-host spacing, timeout, retry with backoff on 429/5xx/network errors. */
export async function politeFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { method = 'GET', body, headers = {}, minIntervalMs = 300, retries = 3, timeoutMs = 20000 } = opts;
  const host = new URL(url).host;
  let attempt = 0;
  for (;;) {
    // Reserve the next free slot for this host synchronously so concurrent callers queue instead of firing together.
    const now = Date.now();
    const slot = Math.max(now, (lastHit.get(host) ?? 0) + minIntervalMs);
    lastHit.set(host, slot);
    if (slot > now) await sleep(slot - now);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json, application/xml, text/xml, application/rss+xml, */*',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        attempt++;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (e) {
      if (attempt >= retries) throw e;
      attempt++;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

export async function getJson<T = any>(url: string, opts?: FetchOpts): Promise<T> {
  const res = await politeFetch(url, opts);
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

export async function getText(url: string, opts?: FetchOpts): Promise<string> {
  const res = await politeFetch(url, opts);
  if (!res.ok) throw new HttpError(res.status, url);
  return await res.text();
}
