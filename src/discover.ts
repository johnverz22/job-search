/** Finds ATS boards and adds the ones that answer to data/sources.json. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { discoverCustomDomains } from './discovery/customDomains.js';
import { detectAts, discoverablePlatforms, extractSlug, type Candidate } from './discovery/patterns.js';
import { commonCrawlCandidates, crtshCandidates } from './discovery/sources.js';
import { addCandidates, type AddOptions } from './discovery/validate.js';
import { getText } from './http.js';
import { sourcesPath } from './sources.js';
import { PLATFORMS, type Platform } from './types.js';

export const usage = `usage: discover <command> [--dry] [--limit N]
  crtsh <platform>              hostnames from Certificate Transparency (subdomain platforms)
  cc <platform> [--pages N] [--crawl CC-MAIN-YYYY-WW]   Common Crawl index (N index pages, default 5)
  urls <file|->                 extract slugs from a file of URLs (one per line), e.g. exported search results
  page <url>                    detect ATS boards linked/embedded on a company careers page
  domains <file|->              seed list of company domains/careers URLs (one per line): scan their careers pages and probe
                                the hosts for custom-domain Recruitee/Personio/Rippling/Teamtailor boards
platforms: ${discoverablePlatforms.join(', ')}
Each new candidate is probed and added to data/sources.json (or $SOURCES_FILE) only if its board answers.
--limit N  probe at most N new candidates (default 100)
--dry      list candidates; probe and write nothing`;

const VALUE_FLAGS = ['--limit', '--pages', '--crawl'];

export function parseArgs(args: readonly string[]) {
  const positional: string[] = [];
  const options: Record<string, string> = {};
  let dry = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry') dry = true;
    else if (VALUE_FLAGS.includes(a) && args[i + 1] !== undefined) options[a.slice(2)] = args[++i];
    else if (a.startsWith('--')) return null;
    else positional.push(a);
  }
  const limit = options.limit === undefined ? undefined : Number(options.limit);
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) return null;
  return { command: positional[0], target: positional[1], dry, limit, pages: Number(options.pages ?? 5), crawl: options.crawl };
}

const readLines = (target: string) => readFileSync(target === '-' ? 0 : target, 'utf8').split(/\r?\n/);

/** Returns the exit code. `deps` lets tests supply connectors, the file and a logger. */
export async function runDiscover(argv: readonly string[], deps: Partial<AddOptions> = {}): Promise<number> {
  const log = deps.log ?? console.log;
  const args = parseArgs(argv);
  const platform = args?.target as Platform;
  const known = PLATFORMS.includes(platform);
  let candidates: Candidate[] | null = null;
  if (args?.command === 'crtsh' && known) candidates = await crtshCandidates(platform, log);
  else if (args?.command === 'cc' && known) candidates = await commonCrawlCandidates(platform, { maxPages: args.pages, crawl: args.crawl }, log);
  else if (args?.command === 'urls' && args.target) candidates = readLines(args.target).map((l) => extractSlug(l.trim())).filter((c): c is Candidate => !!c);
  else if (args?.command === 'domains' && args.target) candidates = await discoverCustomDomains(readLines(args.target), undefined, log);
  else if (args?.command === 'page' && args.target) candidates = detectAts(await getText(args.target), args.target);
  if (!args || !candidates) {
    log(usage);
    return 1;
  }
  await addCandidates(candidates, { file: sourcesPath(), ...deps, dry: args.dry, limit: args.limit });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDiscover(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error((e as Error).message ?? e); process.exitCode = 1; });
}
