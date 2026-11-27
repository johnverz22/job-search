/** Editing data/sources.json: merge, remove and write, keeping the file sorted and valid for loadSources(). */
import { renameSync, writeFileSync } from 'node:fs';
import type { SourceEntry } from '../model.js';
import { parseSources } from '../sources.js';

const idOf = (s: SourceEntry) => `${s.platform}/${s.slug}`;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Union of both lists, sorted by platform then slug. An existing entry (and its note) wins over a new duplicate. */
export function mergeSources(existing: readonly SourceEntry[], added: readonly SourceEntry[]): SourceEntry[] {
  const byId = new Map<string, SourceEntry>();
  for (const s of [...existing, ...added]) if (!byId.has(idOf(s))) byId.set(idOf(s), s);
  return [...byId.values()].sort((a, b) => compare(a.platform, b.platform) || compare(a.slug, b.slug));
}

export function formatSources(list: readonly SourceEntry[]): string {
  const rows = list.map(({ platform, slug, note }) => `    ${JSON.stringify({ platform, slug, ...(note ? { note } : {}) })}`);
  return `{\n  "sources": [\n${rows.join(',\n')}${rows.length ? '\n' : ''}  ]\n}\n`;
}

/** Atomic: a crash mid-write leaves the previous file. Refuses to write anything loadSources() would reject. */
export function writeSources(path: string, list: readonly SourceEntry[]): void {
  const text = formatSources(list);
  parseSources(text, path);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
