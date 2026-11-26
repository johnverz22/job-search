export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** GET /api/<path>. Rejects with ApiError carrying the API's `error` code and human `message` for 4xx/5xx. */
export async function getJson<T>(path: string, params?: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const qs = params?.toString();
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs ? `?${qs}` : ''}`, { signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = await res.json();
    } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, body.error ?? 'error', body.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}
