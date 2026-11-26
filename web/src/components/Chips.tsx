import { X } from 'lucide-react';
import { activeChips, clearFilters, type Filters } from '../lib/search';
import { btnGhost } from './ui';

export function Chips({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const chips = activeChips(filters);
  if (!chips.length) return null;
  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <li key={c.key}>
          <button type="button" onClick={() => onChange(c.remove(filters))} aria-label={`Remove filter: ${c.label}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface pl-3 pr-2 text-sm hover:bg-accent-soft lg:min-h-8">
            {c.label}
            <X size={16} aria-hidden="true" />
          </button>
        </li>
      ))}
      <li><button type="button" className={btnGhost} onClick={() => onChange(clearFilters(filters))}>Clear all</button></li>
    </ul>
  );
}
