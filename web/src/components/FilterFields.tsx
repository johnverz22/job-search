import { useId, useState } from 'react';
import type { FacetValue, Facets } from '../api/types';
import { PLATFORMS, platformLabel } from '../lib/platforms';
import { POSTED_OPTIONS, type Filters, type Tri } from '../lib/search';
import { DebouncedInput } from './DebouncedInput';
import { inputCls } from './ui';

interface Props {
  value: Filters;
  onChange: (f: Filters) => void;
  facets: Facets | undefined;
  /** Text inputs commit immediately (sheet draft) or after a pause (sidebar bound to the URL). */
  delay?: number;
}

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD'];
const SHOW_FIRST = 8;

function Group({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-2 text-sm font-semibold text-text">{legend}</legend>
      {children}
    </fieldset>
  );
}

function Check({ checked, onChange, label, count }: { checked: boolean; onChange: (v: boolean) => void; label: string; count?: number }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm lg:min-h-8">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 shrink-0 accent-[var(--accent)] lg:size-4" />
      <span className="min-w-0 flex-1">{label}</span>
      {count !== undefined && <span className="text-xs text-muted">{count.toLocaleString('en')}</span>}
    </label>
  );
}

const toggle = (list: string[], v: string, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));

/** Facet-backed checkbox list; selected values missing from the facets (e.g. from a shared URL) stay visible. */
function CheckList({ legend, selected, options, onChange }: { legend: string; selected: string[]; options: FacetValue[] | undefined; onChange: (v: string[]) => void }) {
  const [all, setAll] = useState(false);
  const known = new Set((options ?? []).map((o) => o.value.toLowerCase()));
  const merged = [...(options ?? []), ...selected.filter((s) => !known.has(s.toLowerCase())).map((value) => ({ value, count: undefined as number | undefined }))];
  if (!merged.length) return null;
  const shown = all ? merged : merged.filter((o, i) => i < SHOW_FIRST || selected.some((s) => s.toLowerCase() === o.value.toLowerCase()));
  return (
    <Group legend={legend}>
      {shown.map((o) => {
        const on = selected.some((s) => s.toLowerCase() === o.value.toLowerCase());
        return <Check key={o.value} label={o.value} count={o.count} checked={on} onChange={(c) => onChange(toggle(selected.filter((s) => s.toLowerCase() !== o.value.toLowerCase()), o.value, c))} />;
      })}
      {merged.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-1 min-h-11 text-sm font-medium text-accent underline lg:min-h-8">Show all {merged.length}</button>
      )}
    </Group>
  );
}

export function FilterFields({ value, onChange, facets, delay = 400 }: Props) {
  const uid = useId();
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  const platformCounts = new Map((facets?.platform ?? []).map((p) => [p.value, p.count]));
  const currencies = [...new Set([...(facets?.salary_currency.map((c) => c.value) ?? []), ...COMMON_CURRENCIES, ...(value.salary_currency ? [value.salary_currency] : [])])];
  const hasCurrency = Boolean(value.salary_currency);

  return (
    <div className="flex flex-col gap-6">
      <Group legend="Work location">
        {([['any', 'Any'], ['true', 'Remote'], ['false', 'On-site or hybrid']] as [Tri, string][]).map(([v, label]) => (
          <label key={v} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm lg:min-h-8">
            <input type="radio" name={`${uid}-remote`} checked={value.remote === v} onChange={() => set({ remote: v })} className="size-5 accent-[var(--accent)] lg:size-4" />
            {label}
          </label>
        ))}
        <p className="mt-1 text-xs text-muted">Jobs with unknown remote status only show under Any.</p>
      </Group>

      <div>
        <label htmlFor={`${uid}-posted`} className="mb-2 block text-sm font-semibold">Posted</label>
        <select id={`${uid}-posted`} className={inputCls} value={value.posted_within_days ?? ''} onChange={(e) => set({ posted_within_days: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Any time</option>
          {POSTED_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor={`${uid}-loc`} className="mb-2 block text-sm font-semibold">Location</label>
        <DebouncedInput id={`${uid}-loc`} className={inputCls} placeholder="City, region or country" list={`${uid}-locs`} value={value.location} onCommit={(location) => set({ location })} delay={delay} autoComplete="off" />
        <datalist id={`${uid}-locs`}>{(facets?.location ?? []).slice(0, 50).map((l) => <option key={l.value} value={l.value} />)}</datalist>
      </div>

      <div>
        <label htmlFor={`${uid}-dep`} className="mb-2 block text-sm font-semibold">Department</label>
        <DebouncedInput id={`${uid}-dep`} className={inputCls} placeholder="e.g. Engineering" list={`${uid}-deps`} value={value.department} onCommit={(department) => set({ department })} delay={delay} autoComplete="off" />
        <datalist id={`${uid}-deps`}>{(facets?.department ?? []).slice(0, 50).map((d) => <option key={d.value} value={d.value} />)}</datalist>
      </div>

      <CheckList legend="Employment type" selected={value.employment_type} options={facets?.employment_type} onChange={(employment_type) => set({ employment_type })} />
      <CheckList legend="Seniority" selected={value.seniority} options={facets?.seniority} onChange={(seniority) => set({ seniority })} />

      <Group legend="Source">
        {PLATFORMS.map((p) => (
          <Check key={p} label={platformLabel(p)} count={platformCounts.get(p)} checked={value.platform.includes(p)} onChange={(c) => set({ platform: toggle(value.platform, p, c) })} />
        ))}
      </Group>

      <div>
        <label htmlFor={`${uid}-co`} className="mb-2 block text-sm font-semibold">Company</label>
        <DebouncedInput id={`${uid}-co`} className={inputCls} placeholder="Company id, e.g. acme" value={value.company.join(', ')} onCommit={(v) => set({ company: v.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) })} delay={delay} autoComplete="off" autoCapitalize="none" />
        <p className="mt-1 text-xs text-muted">Exact company id, as shown in the job&apos;s link. Separate several with commas.</p>
      </div>

      <Group legend="Salary">
        <label htmlFor={`${uid}-cur`} className="sr-only">Currency</label>
        <select id={`${uid}-cur`} className={inputCls} value={value.salary_currency} onChange={(e) => set(e.target.value ? { salary_currency: e.target.value } : { salary_currency: '', min_salary: '', max_salary: '' })}>
          <option value="">Choose a currency to filter by pay</option>
          {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`${uid}-min`} className="sr-only">Minimum salary</label>
            <DebouncedInput id={`${uid}-min`} type="number" inputMode="numeric" min={0} className={inputCls} placeholder="Min" disabled={!hasCurrency} value={value.min_salary} onCommit={(min_salary) => set({ min_salary })} delay={delay} />
          </div>
          <div>
            <label htmlFor={`${uid}-max`} className="sr-only">Maximum salary</label>
            <DebouncedInput id={`${uid}-max`} type="number" inputMode="numeric" min={0} className={inputCls} placeholder="Max" disabled={!hasCurrency} value={value.max_salary} onCommit={(max_salary) => set({ max_salary })} delay={delay} />
          </div>
        </div>
        <p className="mt-1 text-xs text-muted">Pay is shown as advertised and not converted between currencies or per-hour/month/year.</p>
        <label htmlFor={`${uid}-has`} className="mb-2 mt-3 block text-sm font-semibold">Salary listed</label>
        <select id={`${uid}-has`} className={inputCls} value={value.has_salary} onChange={(e) => set({ has_salary: e.target.value as Tri })}>
          <option value="any">Either</option>
          <option value="true">Only jobs with a salary</option>
          <option value="false">Only jobs without a salary</option>
        </select>
      </Group>

      <Check label="Hide duplicate postings" checked={value.distinct} onChange={(distinct) => set({ distinct })} />
    </div>
  );
}
