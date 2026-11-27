/**
 * Optional on-disk copy of the in-memory jobs, so a restart does not start from an empty list. Gzipped JSON lines: a header,
 * then for each source one "source" line followed by its jobs (line by line, so size is not limited by the maximum string
 * length). Derived fields (id, search text, ...) are recomputed on load.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip, createGzip } from 'node:zlib';
import { toRecord, type JobRecord, type SourceEntry } from './model.js';
import { PLATFORMS } from './types.js';

const VERSION = 1;

export interface SnapshotSource {
  platform: SourceEntry['platform'];
  slug: string;
  lastOkAt: string | null;
  records: JobRecord[];
}

function* lines(sources: readonly SnapshotSource[]) {
  yield `${JSON.stringify({ type: 'snapshot', version: VERSION, savedAt: new Date().toISOString() })}\n`;
  for (const s of sources) {
    yield `${JSON.stringify({ type: 'source', platform: s.platform, slug: s.slug, lastOkAt: s.lastOkAt, jobs: s.records.length })}\n`;
    for (const r of s.records) {
      const { search: _s, id: _i, key: _k, dedupeKey: _d, sortTs: _t, ...stored } = r;
      yield `${JSON.stringify(stored)}\n`;
    }
  }
  yield `${JSON.stringify({ type: 'end' })}\n`;
}

/** Writes to a temporary file first and renames it, so a crash cannot leave a half-written snapshot in place. */
export async function writeSnapshot(path: string, sources: readonly SnapshotSource[]): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await pipeline(Readable.from(lines(sources)), createGzip(), createWriteStream(tmp));
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

function revive(v: any): JobRecord {
  if (!v || typeof v.externalId !== 'string' || typeof v.companySlug !== 'string' || typeof v.title !== 'string'
    || !(PLATFORMS as readonly string[]).includes(v.platform) || !Array.isArray(v.locations) || !Number.isFinite(Date.parse(v.firstSeen))
    || !Number.isFinite(Date.parse(v.lastSeen))) {
    throw new Error('malformed job entry');
  }
  return toRecord(v, { firstSeen: v.firstSeen } as JobRecord, new Date(v.lastSeen));
}

/** Splits on "\n" only: JSON strings may legally contain other Unicode line separators. */
async function* splitLines(chunks: AsyncIterable<Buffer>) {
  const decoder = new StringDecoder('utf8');
  let parts: string[] = [];
  for await (const chunk of chunks) {
    const text = decoder.write(chunk);
    let from = 0;
    for (let nl = text.indexOf('\n'); nl !== -1; nl = text.indexOf('\n', from)) {
      parts.push(text.slice(from, nl));
      yield parts.join('');
      parts = [];
      from = nl + 1;
    }
    parts.push(text.slice(from));
  }
  const rest = parts.join('') + decoder.end();
  if (rest) yield rest;
}

/** Null if there is no snapshot. Throws if the file is unreadable, truncated or malformed. */
export async function readSnapshot(path: string): Promise<SnapshotSource[] | null> {
  const file = createReadStream(path);
  try {
    await new Promise<void>((resolve, reject) => file.once('open', () => resolve()).once('error', reject));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  const out: SnapshotSource[] = [];
  let header = false;
  let ended = false;
  await pipeline(file, createGunzip(), async (stream: AsyncIterable<Buffer>) => {
    for await (const line of splitLines(stream)) {
      const v = JSON.parse(line);
      if (!header) {
        if (v?.type !== 'snapshot' || v.version !== VERSION) throw new Error('not a snapshot of a supported version');
        header = true;
      } else if (v?.type === 'source') {
        out.push({ platform: v.platform, slug: v.slug, lastOkAt: v.lastOkAt ?? null, records: [] });
      } else if (v?.type === 'end') {
        ended = true;
      } else {
        const current = out[out.length - 1];
        if (!current) throw new Error('job entry before any source');
        current.records.push(revive(v));
      }
    }
  });
  if (!ended) throw new Error('snapshot is truncated');
  return out;
}
