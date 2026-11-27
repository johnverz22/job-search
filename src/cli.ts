/** Manage data/sources.json and probe single boards. */
import { pathToFileURL } from 'node:url';
import { connectors as liveConnectors } from './connectors/index.js';
import { mergeSources, writeSources } from './discovery/sourceList.js';
import { probe } from './discovery/validate.js';
import { loadSources, sourcesPath } from './sources.js';
import { PLATFORMS, type Connector, type Platform } from './types.js';

export const usage = `usage:
  cli add <platform> <slug>     probe a board and add it to data/sources.json (or $SOURCES_FILE). Slug formats:
      most platforms   company subdomain/identifier, e.g. acme
      teamtailor       careers host, e.g. acme.teamtailor.com or a custom domain
      recruitee/personio  subdomain, or a full careers host for a custom domain (contains a dot), e.g. careers.acme.com
      icims            portal subdomain, e.g. careers-acme
      workday          {tenant}.{wdN}/{site}, e.g. nvidia.wd5/NVIDIAExternalCareerSite
      taleo            {sub}/{pod}/{org}/{cws} from a tbe.taleo.net searchResults URL
      yc               YC company slug, e.g. airbnb
  cli remove <platform> <slug>  take a source off the list
  cli list                      print the listed sources
  cli probe <platform> <slug>   live-fetch and print count + first jobs (changes nothing)
platforms: ${PLATFORMS.join(', ')}`;

export interface CliDeps {
  file?: string;
  connectors?: Record<Platform, Connector>;
  log?: (message: unknown) => void;
}

/** Returns the exit code. */
export async function runCli(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const { file = sourcesPath(), connectors = liveConnectors, log = console.log } = deps;
  const [command, platform, slug] = argv;

  if (command === 'list') {
    const list = loadSources(file);
    for (const s of list) log(`${s.platform} ${s.slug}${s.note ? `  # ${s.note}` : ''}`);
    log(`${list.length} sources in ${file}`);
    return 0;
  }
  if (!['add', 'remove', 'probe'].includes(command) || !PLATFORMS.includes(platform as Platform) || !slug?.trim()) {
    log(usage);
    return 1;
  }
  const entry = { platform: platform as Platform, slug: slug.trim() };
  const tag = `${entry.platform}/${entry.slug}`;
  const listed = () => loadSources(file).some((s) => s.platform === entry.platform && s.slug === entry.slug);

  if (command === 'probe') {
    const jobs = await connectors[entry.platform].fetchJobs(entry.slug);
    log(`${tag}: ${jobs.length} jobs`);
    for (const j of jobs.slice(0, 3)) log({ ...j, descriptionHtml: j.descriptionHtml?.slice(0, 120) ?? null, raw: undefined });
    return 0;
  }
  if (command === 'remove') {
    if (!listed()) {
      log(`${tag} is not listed`);
      return 1;
    }
    writeSources(file, loadSources(file).filter((s) => !(s.platform === entry.platform && s.slug === entry.slug)));
    log(`removed ${tag}`);
    return 0;
  }
  if (listed()) {
    log(`${tag} is already listed`);
    return 0;
  }
  const result = await probe(entry, connectors);
  if (result.status !== 'valid') {
    log(`not added: ${tag} is ${result.status}: ${result.error}`);
    return 1;
  }
  writeSources(file, mergeSources(loadSources(file), [entry]));
  log(`added ${tag} (${result.jobs} jobs${result.jobs === 0 ? ' - check this one: empty board' : ''})`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error((e as Error).message ?? e); process.exitCode = 1; });
}
