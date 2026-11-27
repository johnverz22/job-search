import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PLATFORMS } from '../src/types.js';
import { DEFAULT_SOURCES_FILE, SourcesError, loadSources, parseSources, sourcesPath } from '../src/sources.js';

const ok = (sources: unknown[]) => JSON.stringify({ sources });

describe('parseSources', () => {
  it('accepts a valid list, trims, keeps notes, and drops exact duplicates (first wins)', () => {
    const out = parseSources(ok([
      { platform: 'gem', slug: ' superblocks ', note: 'first' },
      { platform: 'gem', slug: 'superblocks', note: 'dup' },
      { platform: 'workday', slug: 'nvidia.wd5/NVIDIAExternalCareerSite' },
      { platform: 'gem', slug: 'Superblocks' }, // different case is a different slug (slugs can be case-sensitive)
    ]));
    expect(out).toEqual([
      { platform: 'gem', slug: 'superblocks', note: 'first' },
      { platform: 'workday', slug: 'nvidia.wd5/NVIDIAExternalCareerSite' },
      { platform: 'gem', slug: 'Superblocks' },
    ]);
  });

  it('accepts an empty list', () => expect(parseSources(ok([]))).toEqual([]));

  it('accepts every known platform', () => {
    expect(parseSources(ok(PLATFORMS.map((platform) => ({ platform, slug: 'x' })))).map((s) => s.platform)).toEqual([...PLATFORMS]);
  });

  it.each([
    ['unknown platform', ok([{ platform: 'gem', slug: 'a' }, { platform: 'linkedin', slug: 'a' }]), /sources\[1\].*unknown platform "linkedin"/],
    ['missing platform', ok([{ slug: 'a' }]), /sources\[0\].*unknown platform undefined/],
    ['missing slug', ok([{ platform: 'gem' }]), /sources\[0\] \(gem\) is missing a "slug"/],
    ['blank slug', ok([{ platform: 'gem', slug: '   ' }]), /missing a "slug"/],
    ['non-string slug', ok([{ platform: 'gem', slug: 5 }]), /missing a "slug"/],
    ['non-object entry', ok(['gem/superblocks']), /sources\[0\] must be an object/],
    ['array entry', ok([['gem', 'x']]), /must be an object/],
    ['bad note', ok([{ platform: 'gem', slug: 'a', note: 3 }]), /"note" must be a string/],
    ['no sources key', JSON.stringify({ nope: [] }), /expected an object with a "sources" array/],
    ['sources not an array', JSON.stringify({ sources: {} }), /"sources" array/],
    ['top-level array', '[]', /"sources" array/],
    ['null', 'null', /"sources" array/],
    ['invalid JSON', '{ not json', /not valid JSON/],
    ['empty file', '', /not valid JSON/],
  ])('rejects %s with a readable message', (_n, text, msg) => {
    expect(() => parseSources(text, 'test.json')).toThrow(SourcesError);
    expect(() => parseSources(text, 'test.json')).toThrow(msg);
    expect(() => parseSources(text, 'test.json')).toThrow(/^test\.json/);
  });
});

describe('loadSources', () => {
  const saved = process.env.SOURCES_FILE;
  afterEach(() => { if (saved === undefined) delete process.env.SOURCES_FILE; else process.env.SOURCES_FILE = saved; });

  it('the committed data/sources.json is valid and contains the seed sources', () => {
    const list = loadSources(DEFAULT_SOURCES_FILE);
    expect(list).toEqual(expect.arrayContaining([
      { platform: 'gem', slug: 'superblocks' }, { platform: 'personio', slug: 'aiya-europe' }, { platform: 'pinpoint', slug: 'safetywing' },
    ]));
  });

  it('honours SOURCES_FILE', () => {
    const dir = mkdtempSync(join(tmpdir(), 'src-'));
    const file = join(dir, 's.json');
    writeFileSync(file, ok([{ platform: 'jobvite', slug: 'acme' }]));
    process.env.SOURCES_FILE = file;
    expect(sourcesPath()).toBe(file);
    expect(loadSources()).toEqual([{ platform: 'jobvite', slug: 'acme' }]);
    delete process.env.SOURCES_FILE;
    expect(sourcesPath()).toBe(DEFAULT_SOURCES_FILE);
  });

  it('reports a missing file clearly', () => {
    expect(() => loadSources('/definitely/not/here.json')).toThrow(/cannot read sources file \/definitely\/not\/here\.json/);
  });
});
