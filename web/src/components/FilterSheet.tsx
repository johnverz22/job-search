import * as Dialog from '@radix-ui/react-dialog';
import { SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';
import type { Facets } from '../api/types';
import { EMPTY_FILTERS, activeFilterCount, clearFilters, type Filters } from '../lib/search';
import { FilterFields } from './FilterFields';
import { btnPrimary, btnSecondary, useMediaQuery } from './ui';

interface Props {
  filters: Filters;
  facets: Facets | undefined;
  onApply: (f: Filters) => void;
}

/**
 * Filters below lg, as a dialog: bottom sheet (base), centered sheet (sm), left drawer (md). From lg the sidebar takes over,
 * so an open dialog closes itself when the viewport grows. Edits are a draft until "Show results".
 */
export function FilterSheet({ filters, facets, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const isLg = useMediaQuery('(min-width: 1024px)');
  if (isLg && open) setOpen(false); // sidebar takes over from lg; derived during render rather than in an effect
  const count = activeFilterCount(filters);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={`${btnSecondary} lg:hidden`}>
        <SlidersHorizontal size={18} aria-hidden="true" />
        Filters{count > 0 && <span className="rounded-full bg-accent px-2 text-xs text-accent-fg" aria-label={`${count} active`}>{count}</span>}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl border border-border bg-surface text-text shadow-xl
            sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[6dvh] sm:max-h-[88dvh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:rounded-2xl
            md:bottom-0 md:left-0 md:top-0 md:h-dvh md:max-h-none md:max-w-sm md:translate-x-0 md:rounded-none md:rounded-r-2xl"
        >
          <SheetBody filters={filters} facets={facets} onApply={(f) => { onApply(f); setOpen(false); }} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SheetBody({ filters, facets, onApply }: Props) {
  const [draft, setDraft] = useState(filters);
  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <Dialog.Title className="text-lg font-semibold">Filters</Dialog.Title>
        <Dialog.Close className="grid size-11 place-items-center rounded-lg hover:bg-accent-soft" aria-label="Close filters"><X size={20} aria-hidden="true" /></Dialog.Close>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <FilterFields value={draft} onChange={setDraft} facets={facets} delay={0} />
      </div>
      <div className="flex gap-3 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button type="button" className={`${btnSecondary} flex-1`} onClick={() => setDraft(clearFilters({ ...EMPTY_FILTERS, ...draft }))}>Clear all</button>
        <button type="button" className={`${btnPrimary} flex-[2]`} onClick={() => onApply(draft)}>Show results</button>
      </div>
    </>
  );
}
