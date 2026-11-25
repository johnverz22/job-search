import { pool } from './db.js';
import { buildApp } from './app.js';

const app = buildApp(pool, { logger: true });

app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8080) }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
