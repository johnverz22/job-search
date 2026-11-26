import { useEffect, useSyncExternalStore } from 'react';

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

// 44px touch targets below lg, denser from lg up.
const btn = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors lg:min-h-9 disabled:cursor-not-allowed disabled:opacity-50';
export const btnPrimary = `${btn} bg-accent text-accent-fg hover:opacity-90`;
export const btnSecondary = `${btn} border border-border bg-surface text-text hover:bg-accent-soft`;
export const btnGhost = `${btn} text-accent hover:bg-accent-soft`;
// 16px text so iOS Safari does not zoom on focus.
export const inputCls = 'min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-base text-text placeholder:text-muted lg:min-h-9 lg:text-sm disabled:opacity-50';
export const badgeCls = 'inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-text';

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Job search` : 'Job search';
  }, [title]);
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('rounded-md bg-border/60 motion-safe:animate-pulse', className)} />;
}
