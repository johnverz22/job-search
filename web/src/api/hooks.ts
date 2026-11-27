import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { toApiParams, type Filters } from '../lib/search';
import { ApiError, getJson } from './client';
import type { Facets, JobDetail, JobsPage, Stats } from './types';

export const PAGE_SIZE = 50;

export function useJobs(filters: Filters) {
  const base = toApiParams(filters);
  return useInfiniteQuery({
    queryKey: ['jobs', base.toString()],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams(base);
      p.set('limit', String(PAGE_SIZE));
      if (pageParam) p.set('cursor', pageParam);
      return getJson<JobsPage>('/jobs', p, signal);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
    // A 400 means the query itself is bad; retrying cannot help.
    retry: (n, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 2,
  });
}

export const useJob = (id: string) =>
  useQuery({ queryKey: ['job', id], queryFn: ({ signal }) => getJson<JobDetail>(`/jobs/${encodeURIComponent(id)}`, undefined, signal), retry: (n, e) => !(e instanceof ApiError && e.status < 500 && e.status > 0) && n < 2 });

export const useFacets = () => useQuery({ queryKey: ['facets'], queryFn: ({ signal }) => getJson<Facets>('/facets', undefined, signal), staleTime: 5 * 60_000 });

/** Polls every 5s while the server's first crawl is running, then stops. */
export const useCrawlProgress = () =>
  useQuery({
    queryKey: ['crawl'],
    queryFn: async ({ signal }) => (await getJson<Stats>('/stats', undefined, signal)).crawl ?? null,
    refetchInterval: (q) => (q.state.data?.ready ? false : 5_000),
    staleTime: (q) => (q.state.data?.ready ? 5 * 60_000 : 0),
  });

export const useStats = () =>
  useQuery({ queryKey: ['stats'], queryFn: ({ signal }) => getJson<Stats>('/stats', undefined, signal), refetchInterval: 60_000, refetchIntervalInBackground: false });
