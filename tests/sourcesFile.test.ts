import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { parseArgs, runDiscover } from '../src/discover.js';
import { formatSources, mergeSources } from '../src/discovery/sourceList.js';
import { addCandidates, probe } from '../src/discovery/validate.js';
import { HttpError } from '../src/http.js';
import { loadSources, parseSources } from '../src/sources.js';
import { PLATFORMS, type Connector, type Platform } from '../src/types.js';
import { normalized } from './helpers/records.js';

/** The slug decides what the fake board does. */
const connectors = Object.fromEntries(PLATFORMS.map((platform): [Platform, Connector] => [platform, {
  platform,
  async fetchJobs(slug) {
    if (slug.startsWith('gone')) throw new HttpError(404, 'u');
    if (slug.startsWith('down')) throw new HttpError(503, 'u');
    return slug.startsWith('empty') ? [] : [normalized('1')];
  },
}])) as Record<Platform, Connector>;

function sourcesFile(content = '{"sources":[{"platform":"gem","slug":"zeta","note":"keep me"}]}') {
  const file = join(mkdtempSync(join(tmpdir(), 'src-')), 'sources.json');
  writeFileSync(file, content);
  return file;
}

function setup() {
  const file = sourcesFile();
  const output: string[] = [];
  return { file, output, deps: { file, connectors, log: (m: unknown) => void output.push(String(m)) } };
}
const slugs = (file: string) => loadSources(file).map((s) => `${s.platform}/${s.slug}`);

describe('source list', () => {
  it('merges idempotently, sorted by platform then slug, keeping notes', () => {
    const a = mergeSources([{ platform: 'gem', slug: 'b', note: 'n' }], [{ platform: 'bamboohr', slug: 'z' }, { platform: 'gem', slug: 'a' }, { platform: 'gem', slug: 'b' }]);
    expect(a).toEqual([{ platform: 'bamboohr', slug: 'z' }, { platform: 'gem', slug: 'a' }, { platform: 'gem', slug: 'b', note: 'n' }]);
    expect(mergeSources(a, a)).toEqual(a);
    expect(parseSources(formatSources(a))).toEqual(a);
    expect(parseSources(formatSources([]))).toEqual([]);
  });
});

describe('validation', () => {
  it('classifies permanent and transient failures', async () => {
    expect(await probe({ platform: 'gem', slug: 'ok' }, connectors)).toEqual({ status: 'valid', jobs: 1 });
    expect(await probe({ platform: 'gem', slug: 'gone' }, connectors)).toMatchObject({ status: 'invalid' });
    expect(await probe({ platform: 'gem', slug: 'down' }, connectors)).toMatchObject({ status: 'transient' });
  });

  it('writes only boards that answer, once', async () => {
    const { file, output, deps } = setup();
    const candidates = ['alpha', 'alpha', 'gone', 'down', 'empty', 'zeta'].map((slug) => ({ platform: 'gem' as const, slug }));
    expect(await addCandidates(candidates, deps)).toEqual({ found: 5, known: 1, valid: 2, invalid: 1, transient: 1, skipped: 0 });
    expect(slugs(file)).toEqual(['gem/alpha', 'gem/empty', 'gem/zeta']);
    expect(output.join('\n')).toMatch(/empty board/);
    const written = readFileSync(file, 'utf8');
    await addCandidates(candidates, deps);
    expect(readFileSync(file, 'utf8')).toBe(written);
  });

  it('honours the limit, and --dry writes and probes nothing', async () => {
    const { file, deps } = setup();
    const many = Array.from({ length: 60 }, (_, i) => ({ platform: 'gem' as const, slug: `s${i}` }));
    const before = readFileSync(file, 'utf8');
    expect(await addCandidates(many, { ...deps, dry: true })).toMatchObject({ valid: 0 });
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(await addCandidates(many, { ...deps, limit: 30 })).toMatchObject({ valid: 30, skipped: 30 });
    expect(loadSources(file)).toHaveLength(31);
  });
});

describe('discover', () => {
  it('parses arguments', () => {
    expect(parseArgs(['--dry', 'cc', 'gem', '--pages', '2', '--limit', '7'])).toMatchObject({ command: 'cc', target: 'gem', dry: true, pages: 2, limit: 7 });
    expect(parseArgs(['urls', 'f', '--limit', 'x'])).toBeNull();
    expect(parseArgs(['urls', 'f', '--bogus'])).toBeNull();
  });

  it('adds boards from a file of URLs, and shows usage otherwise', async () => {
    const { file, deps, output } = setup();
    const urls = join(file, '..', 'urls.txt');
    writeFileSync(urls, 'https://jobs.gem.com/alpha/123\nhttps://example.com/nothing\n');
    expect(await runDiscover(['urls', urls], deps)).toBe(0);
    expect(slugs(file)).toEqual(['gem/alpha', 'gem/zeta']);
    expect(await runDiscover(['validate'], deps)).toBe(1);
    expect(output.at(-1)).toMatch(/^usage/);
  });
});

describe('cli', () => {
  it('adds a validated source, lists and removes it', async () => {
    const { file, deps, output } = setup();
    expect(await runCli(['add', 'gem', 'alpha'], deps)).toBe(0);
    expect(await runCli(['add', 'gem', 'alpha'], deps)).toBe(0);
    expect(slugs(file)).toEqual(['gem/alpha', 'gem/zeta']);
    expect(await runCli(['list'], deps)).toBe(0);
    expect(output.join('\n')).toContain('gem zeta  # keep me');
    expect(await runCli(['remove', 'gem', 'alpha'], deps)).toBe(0);
    expect(await runCli(['remove', 'gem', 'alpha'], deps)).toBe(1);
    expect(slugs(file)).toEqual(['gem/zeta']);
  });

  it('does not add a board that fails, and rejects bad arguments', async () => {
    const { file, deps } = setup();
    expect(await runCli(['add', 'gem', 'gone'], deps)).toBe(1);
    expect(await runCli(['add', 'gem', 'down'], deps)).toBe(1);
    expect(await runCli(['add', 'greenhouse', 'x'], deps)).toBe(1);
    expect(await runCli(['add', 'gem'], deps)).toBe(1);
    expect(slugs(file)).toEqual(['gem/zeta']);
  });
});
