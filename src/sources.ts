import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SourceEntry } from './model.js';
import { PLATFORMS, type Platform } from './types.js';

export const DEFAULT_SOURCES_FILE = fileURLToPath(new URL('../data/sources.json', import.meta.url));

/** Where the source list lives: `SOURCES_FILE` if set, else data/sources.json next to the compiled/dev `src` directory. */
export const sourcesPath = () => process.env.SOURCES_FILE ?? DEFAULT_SOURCES_FILE;

export class SourcesError extends Error {}

/**
 * Parses and validates the sources file contents. Throws SourcesError naming the offending entry; trims values and drops exact
 * duplicates (same platform and slug) silently, keeping the first.
 */
export function parseSources(text: string, origin = 'sources file'): SourceEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new SourcesError(`${origin}: not valid JSON (${(e as Error).message})`);
  }
  const list = (data as { sources?: unknown } | null)?.sources;
  if (!Array.isArray(list)) throw new SourcesError(`${origin}: expected an object with a "sources" array`);

  const seen = new Set<string>();
  const out: SourceEntry[] = [];
  list.forEach((raw, i) => {
    const where = `${origin}: sources[${i}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SourcesError(`${where} must be an object`);
    const { platform, slug, note } = raw as Record<string, unknown>;
    if (typeof platform !== 'string' || !(PLATFORMS as readonly string[]).includes(platform.trim())) {
      throw new SourcesError(`${where} has an unknown platform ${JSON.stringify(platform)} (expected one of: ${PLATFORMS.join(', ')})`);
    }
    if (typeof slug !== 'string' || !slug.trim()) throw new SourcesError(`${where} (${platform}) is missing a "slug"`);
    if (note !== undefined && typeof note !== 'string') throw new SourcesError(`${where} "note" must be a string`);
    const entry: SourceEntry = { platform: platform.trim() as Platform, slug: slug.trim(), ...(note ? { note } : {}) };
    const id = `${entry.platform}/${entry.slug}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push(entry);
  });
  return out;
}

export function loadSources(path: string = sourcesPath()): SourceEntry[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new SourcesError(`cannot read sources file ${path}: ${(e as Error).message}`);
  }
  return parseSources(text, path);
}
