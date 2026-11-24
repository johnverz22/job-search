import { connectors } from './connectors/index.js';
import { pool } from './db.js';
import { PLATFORMS, type Platform } from './types.js';

const [cmd, platform, slug] = process.argv.slice(2);
const usage = `usage:
  cli add <platform> <slug>     register a source (teamtailor slug = careers host, e.g. acme.teamtailor.com)
  cli probe <platform> <slug>   live-fetch and print count + first jobs (no DB needed)
platforms: ${PLATFORMS.join(', ')}`;

async function main() {
  if (!cmd || !PLATFORMS.includes(platform as Platform) || !slug) { console.log(usage); process.exit(1); }
  const p = platform as Platform;
  if (cmd === 'probe') {
    const jobs = await connectors[p].fetchJobs(slug);
    console.log(`${p}/${slug}: ${jobs.length} jobs`);
    for (const j of jobs.slice(0, 3)) console.log({ ...j, descriptionHtml: j.descriptionHtml?.slice(0, 120) ?? null, raw: undefined });
  } else if (cmd === 'add') {
    await pool.query(`INSERT INTO sources (platform, company_slug) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [p, slug]);
    console.log(`added ${p}/${slug}`);
    await pool.end();
  } else { console.log(usage); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
