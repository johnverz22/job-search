import { AlertTriangle, ArrowLeft, Banknote, Building2, Clock, ExternalLink, Globe, MapPin, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useJob } from '../api/hooks';
import type { JobDetail } from '../api/types';
import { Skeleton, badgeCls, btnPrimary, btnSecondary, useTitle } from '../components/ui';
import { companyName, formatSalary, fullDate, relativeDate } from '../lib/format';
import { platformLabel } from '../lib/platforms';
import { sanitizeDescription } from '../lib/sanitize';
import { safeHttpUrl } from '../lib/url';
import { NotFoundView } from './NotFound';

function BackLink() {
  const navigate = useNavigate();
  const { key } = useLocation();
  // Arrived from the search screen: go back in history so filters, loaded pages and scroll position are restored.
  const fromApp = key !== 'default';
  const cls = 'inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent hover:underline lg:min-h-9';
  return fromApp
    ? <button type="button" className={cls} onClick={() => navigate(-1)}><ArrowLeft size={16} aria-hidden="true" />Back to results</button>
    : <Link to="/" className={cls}><ArrowLeft size={16} aria-hidden="true" />All jobs</Link>;
}

function Meta({ job }: { job: JobDetail }) {
  const salary = formatSalary(job);
  const rows: [string, React.ReactNode][] = [
    ['Company', <Link key="c" className="text-accent underline" to={`/?company=${encodeURIComponent(job.company_slug)}`}>{companyName(job.platform, job.company_slug)}</Link>],
    ['Source', platformLabel(job.platform)],
    ['Location', job.locations.length ? job.locations.join(' · ') : 'Not specified'],
    ['Remote', job.remote === null ? 'Not specified' : job.remote ? 'Yes' : 'No (on-site or hybrid)'],
    ['Department', job.department ?? '—'],
    ['Employment type', job.employment_type ?? '—'],
    ['Seniority', job.seniority ?? '—'],
    ['Salary', salary ?? 'Not listed'],
    ['Posted', fullDate(job.posted_at) ?? 'Not specified'],
    ['First seen', fullDate(job.first_seen) ?? '—'],
    ['Last seen', fullDate(job.last_seen) ?? '—'],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0"><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>
      ))}
    </dl>
  );
}

function ApplyButton({ url, title, className }: { url: string | null; title: string; className: string }) {
  const href = safeHttpUrl(url);
  if (!href) return null;
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className} aria-label={`Apply for ${title} (opens in a new tab)`}>Apply <ExternalLink size={16} aria-hidden="true" /></a>;
}

function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading job">
      <p role="status" className="sr-only">Loading job…</p>
      <Skeleton className="h-8 w-3/4" /><Skeleton className="mt-3 h-4 w-1/3" /><Skeleton className="mt-8 h-4 w-full" /><Skeleton className="mt-2 h-4 w-full" /><Skeleton className="mt-2 h-4 w-2/3" />
    </div>
  );
}

export function Component() {
  const { id = '' } = useParams();
  const q = useJob(id);
  const job = q.data;
  const html = useMemo(() => sanitizeDescription(job?.description_html), [job?.description_html]);
  useTitle(job ? `${job.title} · ${companyName(job.platform, job.company_slug)}` : 'Job');

  if (q.isPending) return <><BackLink /><div className="mt-4"><Loading /></div></>;
  if (q.isError) {
    if (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400)) {
      return <NotFoundView title={q.error.status === 404 ? 'Job not found' : 'That isn’t a valid job link'} message={q.error.status === 404 ? 'It may have been removed, or the link is wrong.' : q.error.message} />;
    }
    return (
      <div role="alert" className="rounded-xl border border-border bg-danger-soft p-5">
        <p className="flex items-center gap-2 font-semibold text-danger"><AlertTriangle size={18} aria-hidden="true" />Couldn’t load this job</p>
        <p className="mt-1 text-sm">{q.error.message}</p>
        <button type="button" className={`${btnPrimary} mt-4`} onClick={() => q.refetch()}><RefreshCw size={16} aria-hidden="true" />Try again</button>
      </div>
    );
  }

  const closed = job!.status === 'closed';
  const j = job!;
  const salary = formatSalary(j);
  const posted = relativeDate(j.posted_at ?? j.first_seen);
  const applyCls = closed ? btnSecondary : btnPrimary;

  return (
    <article className="pb-24 sm:pb-0">
      <BackLink />
      {closed && (
        <div role="status" className="mt-3 flex items-start gap-3 rounded-xl border border-border bg-warn-soft p-4 text-warn">
          <AlertTriangle size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
          <div><p className="font-semibold">This posting is no longer open</p><p className="text-sm">It was last seen {fullDate(j.last_seen) ?? 'a while ago'}. The original page may be gone.</p></div>
        </div>
      )}

      <header className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{j.title}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-muted"><Building2 size={16} aria-hidden="true" />{companyName(j.platform, j.company_slug)}<span aria-hidden="true">·</span>{platformLabel(j.platform)}</p>
          <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            {j.locations.length > 0 && <li className="flex items-center gap-1.5"><MapPin size={14} aria-hidden="true" />{j.locations.slice(0, 3).join(' · ')}{j.locations.length > 3 && ` +${j.locations.length - 3}`}</li>}
            {salary && <li className="flex items-center gap-1.5 text-text"><Banknote size={14} aria-hidden="true" />{salary}</li>}
            {posted && <li className="flex items-center gap-1.5"><Clock size={14} aria-hidden="true" />{j.posted_at ? 'Posted' : 'First seen'} {posted}</li>}
          </ul>
          <ul className="mt-3 flex flex-wrap gap-2">
            {j.remote && <li className={badgeCls}><Globe size={12} aria-hidden="true" />Remote</li>}
            {j.employment_type && <li className={badgeCls}>{j.employment_type}</li>}
            {j.seniority && <li className={badgeCls}>{j.seniority}</li>}
          </ul>
        </div>
        {/* sm and md: Apply sits in the header. base: sticky bottom bar. lg: sticky side card. */}
        <ApplyButton url={j.apply_url} title={j.title} className={`${applyCls} hidden shrink-0 sm:inline-flex lg:hidden`} />
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 lg:order-1">
          <h2 className="mb-3 text-lg font-semibold">About this job</h2>
          {html
            ? <div className="prose-job" dangerouslySetInnerHTML={{ __html: html }} />
            : <p className="rounded-lg border border-border bg-surface p-4 text-sm text-muted">The description isn’t available yet. Use the Apply link to read the original posting.</p>}
        </div>
        <aside aria-label="Job details" className="lg:order-2 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-4 hidden lg:block"><ApplyButton url={j.apply_url} title={j.title} className={`${applyCls} w-full`} /></div>
            <h2 className="mb-3 text-base font-semibold">Details</h2>
            <Meta job={j} />
            {safeHttpUrl(j.apply_url) && <a href={safeHttpUrl(j.apply_url)!} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm text-accent underline lg:min-h-9">View original posting <ExternalLink size={14} aria-hidden="true" /></a>}
          </div>
        </aside>
      </div>

      {safeHttpUrl(j.apply_url) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
          <ApplyButton url={j.apply_url} title={j.title} className={`${applyCls} w-full`} />
        </div>
      )}
    </article>
  );
}
