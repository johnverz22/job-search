/**
 * One-shot crawl for snapshot-based deploys (e.g. the scheduled job that feeds Vercel): crawls every
 * configured source once, then writes the snapshot and exits. Unlike the server there is no refresh loop.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createAggregator, optionsFromEnv } from './aggregator.js';
import { loadSources, sourcesPath } from './sources.js';

const READY_TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MINUTES ?? 15) * 60_000;

async function main() {
  const snapshotFile = process.env.SNAPSHOT_FILE ?? 'data/jobs.snapshot';
  const sources = loadSources();
  const agg = createAggregator(sources, { ...optionsFromEnv(), snapshotFile });
  agg.start();
  console.log(`crawling ${sources.length} sources from ${sourcesPath()} -> ${snapshotFile}`);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const { ready, done, total } = agg.progress();
    if (ready || Date.now() >= deadline) break;
    console.log(`crawl: ${done}/${total} sources attempted`);
    await sleep(5000);
  }
  const { ready } = agg.progress();
  if (!ready) console.error(`crawl: timed out after ${READY_TIMEOUT_MS / 60_000} min; writing a partial snapshot`);
  await agg.stop(); // saves the snapshot
  process.exitCode = ready ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error((e as Error).message ?? e); process.exitCode = 1; });
}
