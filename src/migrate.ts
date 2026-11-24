import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './db.js';

export async function migrate(dir = join(process.cwd(), 'migrations')) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(join(dir, f), 'utf8'));
    console.log(`migrated ${f}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.js') || process.argv[1]?.endsWith('migrate.ts')) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
