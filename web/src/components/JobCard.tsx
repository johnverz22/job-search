import { Banknote, Building2, Clock, ExternalLink, Globe, MapPin } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Job } from '../api/types';
import { companyName, formatSalary, locationSummary, relativeDate } from '../lib/format';
import { platformLabel } from '../lib/platforms';
import { safeHttpUrl } from '../lib/url';
import { badgeCls } from './ui';

export function JobCard({ job }: { job: Job }) {
  const salary = formatSalary(job);
  const where = locationSummary(job.locations);
  const posted = relativeDate(job.posted_at ?? job.first_seen);
  const apply = safeHttpUrl(job.apply_url);
  return (
    <article className="relative rounded-xl border border-border bg-surface p-4 transition-colors focus-within:border-accent hover:border-accent sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-base font-semibold leading-snug sm:text-lg">
          {/* Stretched link: the whole card is clickable, while the Apply link below stays independently focusable. */}
          <Link to={`/jobs/${job.id}`} className="after:absolute after:inset-0 after:content-[''] hover:underline">{job.title}</Link>
        </h2>
        {apply && (
          <a href={apply} target="_blank" rel="noopener noreferrer" aria-label={`Apply for ${job.title} (opens in a new tab)`}
            className="relative z-10 hidden min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-accent hover:bg-accent-soft sm:inline-flex lg:min-h-9">
            Apply <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>

      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
        <Building2 size={14} aria-hidden="true" className="shrink-0" />
        <span>{companyName(job.platform, job.company_slug)}</span>
        <span aria-hidden="true">·</span>
        <span>{platformLabel(job.platform)}</span>
      </p>

      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        {where && <li className="flex items-center gap-1.5"><MapPin size={14} aria-hidden="true" />{where}</li>}
        {salary && <li className="flex items-center gap-1.5 text-text"><Banknote size={14} aria-hidden="true" />{salary}</li>}
        {posted && <li className="flex items-center gap-1.5"><Clock size={14} aria-hidden="true" />{job.posted_at ? 'Posted' : 'First seen'} {posted}</li>}
      </ul>

      {(job.remote || job.employment_type || job.seniority || job.department) && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {job.remote && <li className={badgeCls}><Globe size={12} aria-hidden="true" />Remote</li>}
          {job.employment_type && <li className={badgeCls}>{job.employment_type}</li>}
          {job.seniority && <li className={badgeCls}>{job.seniority}</li>}
          {job.department && <li className={badgeCls}>{job.department}</li>}
        </ul>
      )}
    </article>
  );
}
