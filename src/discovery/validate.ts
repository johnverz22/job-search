/** Probes candidate boards with their connector and adds the ones that answer to the sources file. */
import { connectors as liveConnectors } from '../connectors/index.js';
import { HttpError } from '../http.js';
import type { SourceEntry } from '../model.js';
import { loadSources } from '../sources.js';
import type { Connector, Platform } from '../types.js';
import { dedupe, type Candidate } from './patterns.js';
import { mergeSources, writeSources } from './sourceList.js';

export type ProbeResult =
  | { status: 'valid'; jobs: number }
  /** invalid: the board does not exist or refuses us. transient: could not tell; try again later. */
  | { status: 'invalid' | 'transient'; error: string };

const PERMANENT_STATUSES = [400, 401, 403, 404, 410];
const SAVE_EVERY = 25;

export async function probe(c: Candidate, connectors: Record<Platform, Connector> = liveConnectors): Promise<ProbeResult> {
  try {
    const jobs = await connectors[c.platform].fetchJobs(c.slug);
    return { status: 'valid', jobs: jobs.length };
  } catch (e) {
    const error = String((e as Error)?.message ?? e).slice(0, 300);
    const permanent = e instanceof HttpError && PERMANENT_STATUSES.includes(e.status);
    return { status: permanent ? 'invalid' : 'transient', error };
  }
}

export interface AddOptions {
  file: string;
  dry?: boolean;
  /** Most candidates to probe in one run. */
  limit?: number;
  concurrency?: number;
  connectors?: Record<Platform, Connector>;
  log?: (message: string) => void;
}

export interface AddStats {
  found: number;
  known: number;
  valid: number;
  invalid: number;
  transient: number;
  /** New candidates left unprobed because of `limit`. */
  skipped: number;
}

/**
 * Validates candidates that are not in the file yet and merges the valid ones into it (a board with 0 jobs is valid but
 * flagged). With `dry`, nothing is probed or written; the candidates are only listed.
 */
export async function addCandidates(candidates: readonly Candidate[], opts: AddOptions): Promise<AddStats> {
  const { file, dry = false, limit = 100, concurrency = 4, connectors = liveConnectors, log = console.log } = opts;
  const unique = dedupe([...candidates]);
  const listed = new Set(loadSources(file).map((s) => `${s.platform}:${s.slug}`));
  const fresh = unique.filter((c) => !listed.has(`${c.platform}:${c.slug}`));
  const batch = fresh.slice(0, limit);
  const stats: AddStats = { found: unique.length, known: unique.length - fresh.length, valid: 0, invalid: 0, transient: 0, skipped: fresh.length - batch.length };
  log(`found ${stats.found} unique candidates, ${stats.known} already listed`);

  if (dry) {
    for (const c of fresh) log(`candidate ${c.platform}/${c.slug}`);
    log('dry run: nothing probed or written');
    return stats;
  }

  let pending: SourceEntry[] = [];
  const save = () => {
    // Re-read before every write so edits made while a long run is going are not lost.
    if (pending.length) writeSources(file, mergeSources(loadSources(file), pending));
    pending = [];
  };
  let next = 0;
  const worker = async () => {
    while (next < batch.length) {
      const c = batch[next++];
      const tag = `${c.platform}/${c.slug}`;
      const result = await probe(c, connectors);
      stats[result.status]++;
      if (result.status === 'valid') {
        pending.push({ platform: c.platform, slug: c.slug });
        log(`valid     ${tag} (${result.jobs} jobs${result.jobs === 0 ? ' - check this one: empty board' : ''})`);
        if (pending.length >= SAVE_EVERY) save();
      } else {
        log(`${result.status.padEnd(9)} ${tag}: ${result.error}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  save();
  log(`added ${stats.valid}, invalid ${stats.invalid}, transient ${stats.transient}${stats.skipped ? `, ${stats.skipped} not probed (raise --limit)` : ''}`);
  return stats;
}
