import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useStats } from '../api/hooks';
import type { Stats } from '../api/types';
import { Skeleton, btnPrimary, useTitle } from '../components/ui';
import { relativeDate } from '../lib/format';
import { platformLabel } from '../lib/platforms';

const n = (x: number) => x.toLocaleString('en');

function summarize(s: Stats) {
  const byPlatform = new Map<string, { open: number; sources: Record<string, number> }>();
  const row = (p: string) => byPlatform.get(p) ?? byPlatform.set(p, { open: 0, sources: {} }).get(p)!;
  for (const j of s.jobs) row(j.platform).open = j.open;
  for (const src of s.sources) row(src.platform).sources[src.state] = src.n;
  const rows = [...byPlatform].sort(([a], [b]) => a.localeCompare(b)).map(([platform, v]) => ({ platform, ...v }));
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
  return { rows, open: sum((r) => r.open), healthy: sum((r) => r.sources.ok ?? 0), problem: sum((r) => Object.entries(r.sources).filter(([k]) => k === 'failing' || k === 'invalid').reduce((t, [, c]) => t + c, 0)) };
}

const sourceText = (sources: Record<string, number>) => Object.entries(sources).sort(([a], [b]) => (a === 'ok' ? -1 : b === 'ok' ? 1 : a.localeCompare(b))).map(([k, c]) => `${n(c)} ${k.replace(/_/g, ' ')}`).join(', ') || '—';

export function Component() {
  useTitle('Status');
  const q = useStats();
  if (q.isPending) return <div aria-busy="true"><p role="status" className="sr-only">Loading status…</p><Skeleton className="h-8 w-40" /><Skeleton className="mt-6 h-40 w-full" /></div>;
  if (q.isError) {
    return (
      <div role="alert" className="rounded-xl border border-border bg-danger-soft p-5">
        <p className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle size={18} aria-hidden="true" />Couldn’t load status</p>
        <p className="mt-1 text-sm">{q.error.message}</p>
        <button type="button" className={`${btnPrimary} mt-4`} onClick={() => q.refetch()}><RefreshCw size={16} aria-hidden="true" />Try again</button>
      </div>
    );
  }
  const s = summarize(q.data);
  const tiles: [string, string][] = [['Open jobs', n(s.open)], ['Memory used', `${n(q.data.memory_mb)} MB`], ['Healthy sources', n(s.healthy)], ['Sources needing attention', n(s.problem)], ['Waiting to be crawled', n(q.data.queue.due)]];
  const oldest = relativeDate(q.data.queue.oldest_due);

  return (
    <div>
      <h1 className="text-2xl font-bold">Crawl status</h1>
      <p className="mt-1 text-sm text-muted">Refreshes every minute{q.isFetching ? ' · updating…' : ''}.{oldest && q.data.queue.due > 0 ? ` Oldest pending crawl was due ${oldest}.` : ''}</p>

      <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([k, v]) => <div key={k} className="rounded-xl border border-border bg-surface p-4"><dt className="text-sm text-muted">{k}</dt><dd className="mt-1 text-2xl font-bold">{v}</dd></div>)}
      </dl>

      <h2 className="mb-3 mt-8 text-lg font-semibold">By platform</h2>
      {/* base/sm: stacked cards. md+: a real table. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {s.rows.map((r) => (
          <li key={r.platform} className="rounded-xl border border-border bg-surface p-4">
            <p className="font-semibold">{platformLabel(r.platform)}</p>
            <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted">Open</dt><dd className="text-right">{n(r.open)}</dd>
              <dt className="text-muted">Sources</dt><dd className="text-right">{sourceText(r.sources)}</dd>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Jobs and sources per platform</caption>
          <thead className="border-b border-border text-muted"><tr><th scope="col" className="p-3 font-medium">Platform</th><th scope="col" className="p-3 text-right font-medium">Open</th><th scope="col" className="p-3 font-medium">Sources</th></tr></thead>
          <tbody>
            {s.rows.map((r) => <tr key={r.platform} className="border-b border-border last:border-0"><th scope="row" className="p-3 font-medium">{platformLabel(r.platform)}</th><td className="p-3 text-right">{n(r.open)}</td><td className="p-3">{sourceText(r.sources)}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
