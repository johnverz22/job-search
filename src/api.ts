import { pool } from './db.js';
import { fileURLToPath } from 'node:url';
import { buildServer } from './app.js';

// dist/api.js -> ../web/dist (the Docker image and a local `npm run build:web` both put the SPA there)
const webRoot = process.env.WEB_ROOT ?? fileURLToPath(new URL('../web/dist', import.meta.url));
const app = buildServer(pool, { webRoot, fastify: { logger: true } });

app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8080) }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
