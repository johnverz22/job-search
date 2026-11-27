import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFacets } from '../api/hooks';
import { Chips } from '../components/Chips';
import { CrawlBanner } from '../components/CrawlBanner';
import { DebouncedInput } from '../components/DebouncedInput';
import { FilterFields } from '../components/FilterFields';
import { FilterSheet } from '../components/FilterSheet';
import { ResultsList } from '../components/ResultsList';
import { inputCls, useTitle } from '../components/ui';
import { POSTED_OPTIONS, effectiveSort, parseFilters, toSearchString, type Filters } from '../lib/search';

export function Component() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const facets = useFacets().data;
  const searchRef = useRef<HTMLInputElement>(null);
  useTitle(filters.q ? `“${filters.q}”` : 'Jobs');

  // Filter changes are history entries (Back undoes them); typing replaces, so Back is not a keystroke log. The cursor is never kept.
  const setFilters = useCallback((f: Filters, replace = false) => setParams(toSearchString(f), { replace }), [setParams]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sort = effectiveSort(filters);

  return (
    <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-8">
      <aside aria-label="Filters" className="sticky top-4 hidden max-h-[calc(100dvh-2rem)] self-start overflow-y-auto rounded-xl border border-border bg-surface p-5 lg:block">
        <h2 className="mb-4 text-base font-semibold">Filters</h2>
        <FilterFields value={filters} onChange={(f) => setFilters(f)} facets={facets} />
      </aside>

      <section aria-label="Search results" className="min-w-0">
        <h1 className="sr-only">Search jobs</h1>
        <div className="sticky top-0 z-20 -mx-4 bg-bg/95 px-4 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:px-0">
          <form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
            <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <DebouncedInput
              inputRef={searchRef} type="search" name="q" aria-label="Search jobs" placeholder="Search title, company or skill  ( / )" enterKeyHint="search"
              autoComplete="off" className={`${inputCls} pl-10 pr-11`} value={filters.q} onCommit={(q) => setFilters({ ...filters, q, sort: q ? filters.sort : null }, true)}
            />
            {filters.q && (
              <button type="button" aria-label="Clear search" onClick={() => { setFilters({ ...filters, q: '', sort: null }); searchRef.current?.focus(); }}
                className="absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center text-muted hover:text-text lg:size-9"><X size={18} aria-hidden="true" /></button>
            )}
          </form>
          <p className="mt-1 hidden text-xs text-muted sm:block">Tips: <code>&quot;exact phrase&quot;</code>, <code>-exclude</code>, <code>react or vue</code></p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <FilterSheet filters={filters} facets={facets} onApply={(f) => setFilters(f)} />
            {/* md only: quick filters inline. From lg they live in the sidebar; below md they live in the sheet. */}
            <div className="hidden items-center gap-2 md:flex lg:hidden">
              <label className="sr-only" htmlFor="quick-remote">Work location</label>
              <select id="quick-remote" className={`${inputCls} w-auto`} value={filters.remote} onChange={(e) => setFilters({ ...filters, remote: e.target.value as Filters['remote'] })}>
                <option value="any">Any location</option><option value="true">Remote</option><option value="false">On-site or hybrid</option>
              </select>
              <label className="sr-only" htmlFor="quick-posted">Posted</label>
              <select id="quick-posted" className={`${inputCls} w-auto`} value={filters.posted_within_days ?? ''} onChange={(e) => setFilters({ ...filters, posted_within_days: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Any time</option>
                {POSTED_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
              </select>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <label htmlFor="sort" className="sr-only">Sort by</label>
              <select id="sort" className={`${inputCls} w-auto`} value={sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as 'relevance' | 'newest' })}>
                <option value="relevance" disabled={!filters.q}>Best match</option>
                <option value="newest">Newest</option>
              </select>
            </div>
          </div>
        </div>

        <div className="mb-4 mt-1"><Chips filters={filters} onChange={(f) => setFilters(f)} /></div>
        <CrawlBanner />
        <ResultsList filters={filters} onChange={(f) => setFilters(f)} />
      </section>
    </div>
  );
}
