import { AlertTriangle, RefreshCw, SearchX } from 'lucide-react';
import { ApiError } from '../api/client';
import { useJobs } from '../api/hooks';
import { activeChips, clearFilters, type Filters } from '../lib/search';
import { Chips } from './Chips';
import { JobCard } from './JobCard';
import { Skeleton, btnPrimary, btnSecondary, cn } from './ui';

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-hidden="true">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="mt-3 h-4 w-1/3" />
      <Skeleton className="mt-4 h-4 w-1/2" />
      <div className="mt-4 flex gap-2"><Skeleton className="h-5 w-16" /><Skeleton className="h-5 w-20" /></div>
    </div>
  );
}

export function ResultsList({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const q = useJobs(filters);

  if (q.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading jobs" className="flex flex-col gap-3">
        <p role="status" className="sr-only">Loading jobs…</p>
        {Array.from({ length: 6 }, (_, i) => <CardSkeleton key={i} />)}
      </div>
    );
  }

  if (q.isError && !q.data) {
    const invalid = q.error instanceof ApiError && q.error.status === 400;
    return (
      <div role="alert" className="rounded-xl border border-border bg-danger-soft p-5">
        <p className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle size={18} aria-hidden="true" />{invalid ? 'That search can’t be run' : 'Couldn’t load jobs'}</p>
        <p className="mt-1 text-sm">{q.error.message}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {invalid ? <button type="button" className={btnPrimary} onClick={() => onChange(clearFilters(filters))}>Clear filters</button>
            : <button type="button" className={btnPrimary} onClick={() => q.refetch()}><RefreshCw size={16} aria-hidden="true" />Try again</button>}
        </div>
      </div>
    );
  }

  const jobs = q.data?.pages.flatMap((p) => p.jobs) ?? [];

  if (!jobs.length) {
    const hasFilters = activeChips(filters).length > 0;
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-center sm:p-10">
        <SearchX size={32} aria-hidden="true" className="mx-auto text-muted" />
        <h2 className="mt-3 text-lg font-semibold">No jobs match</h2>
        <p className="mx-auto mt-1 max-w-prose text-sm text-muted">
          {filters.q ? 'Try fewer or different words. Very common words like “the” are ignored.' : 'Try removing a filter.'}
          {hasFilters && ' These filters are active:'}
        </p>
        {hasFilters && <div className="mt-4 flex justify-center"><Chips filters={filters} onChange={onChange} /></div>}
        {(filters.q || hasFilters) && <button type="button" className={`${btnSecondary} mt-4`} onClick={() => onChange({ ...clearFilters(filters), q: '', sort: null })}>Start over</button>}
      </div>
    );
  }

  const more = q.hasNextPage;
  return (
    <div className={cn(q.isPlaceholderData && 'opacity-60 transition-opacity')} aria-busy={q.isFetching && !q.isFetchingNextPage}>
      <p role="status" aria-live="polite" className="mb-3 text-sm text-muted">
        {jobs.length.toLocaleString('en')} {jobs.length === 1 ? 'job' : 'jobs'} loaded{more ? ' · more available' : ''}
      </p>
      <ul className="flex flex-col gap-3">
        {jobs.map((j) => <li key={j.id}><JobCard job={j} /></li>)}
      </ul>
      <div className="mt-6 flex flex-col items-center gap-3">
        {q.isFetchNextPageError && (
          <p role="alert" className="text-sm text-danger">Couldn’t load more jobs. {q.error?.message}</p>
        )}
        {more && (
          <button type="button" className={`${btnPrimary} w-full sm:w-auto sm:min-w-48`} disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            {q.isFetchingNextPage ? 'Loading…' : q.isFetchNextPageError ? 'Try again' : 'Load more jobs'}
          </button>
        )}
        {!more && <p className="text-sm text-muted">That’s everything.</p>}
      </div>
    </div>
  );
}
