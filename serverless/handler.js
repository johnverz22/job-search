/**
 * Shared handler for the Vercel functions in api/: the same Fastify app as src/server.ts, but read-only —
 * jobs come from the committed snapshot (data/jobs.snapshot, bundled via functions.includeFiles) instead
 * of a crawl loop, which serverless cannot run. A scheduled GitHub Action refreshes that file.
 *
 * Imports are dynamic so a cold-start failure (missing bundle, bad snapshot) returns its message in the
 * response instead of an opaque FUNCTION_INVOCATION_FAILED.
 */
import { fileURLToPath } from 'node:url';

const snapshotPath = fileURLToPath(new URL('../data/jobs.snapshot', import.meta.url));

let appPromise;
async function getApp() {
  appPromise ??= (async () => {
    const [{ buildServer }, { aggregatorFromSnapshot }, { readSnapshot }, { loadSources }] = await Promise.all([
      import('../dist/app.js'),
      import('../dist/readOnly.js'),
      import('../dist/snapshot.js'),
      import('../dist/sources.js'),
    ]);
    const saved = await readSnapshot(snapshotPath).catch((e) => {
      console.error(`snapshot: ${e instanceof Error ? e.message : e}`);
      return null;
    });
    return buildServer(aggregatorFromSnapshot(loadSources(), saved));
  })();
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    await app.ready();
    app.server.emit('request', req, res);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(e instanceof Error ? (e.stack ?? e.message) : String(e));
  }
}
