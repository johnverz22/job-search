import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useCrawlProgress } from '../api/hooks';

/** Shown after a (re)start while the server is still collecting jobs. Results and filter values refresh as sources finish. */
export function CrawlBanner() {
  const crawl = useCrawlProgress().data;
  const client = useQueryClient();
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (!crawl) return;
    const previous = seen.current;
    // Remember progress only while collecting, so a server that was ready from the start never triggers a refetch.
    if (!crawl.ready || previous !== null) seen.current = crawl.done;
    if (previous !== null && previous !== crawl.done) {
      void client.invalidateQueries({ queryKey: ['jobs'] });
      void client.invalidateQueries({ queryKey: ['facets'] });
    }
  }, [crawl, client]);

  if (!crawl || crawl.ready) return null;
  return (
    <p role="status" aria-label="Crawl progress" className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-accent-soft p-3 text-sm">
      <Loader2 size={16} aria-hidden="true" className="shrink-0 motion-safe:animate-spin" />
      Still collecting jobs ({crawl.done}/{crawl.total} sources). More results will appear shortly.
    </p>
  );
}
