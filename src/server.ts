/** Entrypoint: one process that crawls the configured sources and serves the API and web UI. */
import { fileURLToPath } from 'node:url';
import { createAggregator, optionsFromEnv } from './aggregator.js';
import { buildServer } from './app.js';
import { loadSources, sourcesPath } from './sources.js';

// dist/server.js (and src/server.ts) -> ../web/dist
const webRoot = process.env.WEB_ROOT ?? fileURLToPath(new URL('../web/dist', import.meta.url));

async function main() {
  const sources = loadSources();
  const aggregator = createAggregator(sources, optionsFromEnv());
  const app = buildServer(aggregator, { webRoot, fastify: { logger: true, forceCloseConnections: true } });

  await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8080) });
  app.log.info(`crawling ${sources.length} sources from ${sourcesPath()}`);
  aggregator.start();

  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      app.log.info(`${signal}: shutting down`);
      Promise.all([app.close(), aggregator.stop()])
        // exit explicitly: an abandoned crawl may still hold sockets open
        .then(() => process.exit(0))
        .catch((e) => { app.log.error(e); process.exit(1); });
    });
  }
}

main().catch((e) => {
  console.error((e as Error).message ?? e);
  process.exit(1);
});
