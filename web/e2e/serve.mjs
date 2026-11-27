// Serves the built SPA + API on one port over a deterministic in-memory dataset, for Playwright. No network, no database:
// the real aggregator runs with fake connectors. Prerequisite: `npm run build` in the repo root (builds web/ too).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAggregator } from '../../dist/aggregator.js';
import { buildServer } from '../../dist/app.js';
import { HttpError } from '../../dist/http.js';
import { PLATFORMS } from '../../dist/types.js';

const webRoot = fileURLToPath(new URL('../dist', import.meta.url));
if (!existsSync(`${webRoot}/index.html`)) throw new Error('web/dist is missing: run `npm run build` first');

const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const jobs = [];
function job(externalId, j) {
  jobs.push({ platform: 'gem', companySlug: 'acme-inc', externalId, descriptionHtml: null, locations: [], remote: null, department: null, employmentType: null,
    seniority: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryText: null, postedAt: null, applyUrl: `https://apply.example/${externalId}`, raw: null, ...j });
}

job('react', { title: 'Senior React Developer', department: 'Engineering', locations: ['Berlin, Germany', 'Remote - EU'], remote: true, employmentType: 'Full time', seniority: 'Senior',
  salaryMin: 70000, salaryMax: 95000, salaryCurrency: 'EUR', postedAt: day(2),
  descriptionHtml: '<h2>About the role</h2><p>Build <strong>great</strong> products.</p><ul><li>React</li><li>TypeScript</li></ul><script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 1"><a href="javascript:window.__pwned=1">sneaky</a>' });
job('nodesc', { title: 'Mystery Role', platform: 'workday', companySlug: 'globex.wd5/External' });
for (let i = 1; i <= 120; i++) {
  job(`support-${i}`, { title: `Support Engineer ${i}`, platform: i % 3 ? 'recruitee' : 'gem', companySlug: `company-${i % 7}`, locations: [i % 2 ? 'Manila, Philippines' : 'Austin, TX'],
    remote: i % 4 === 0 ? true : i % 4 === 1 ? false : null, department: 'Support', employmentType: i % 2 ? 'Full time' : 'Contract', postedAt: day(i % 40), descriptionHtml: `<p>Help customers (${i}).</p>` });
}

const sources = [...new Map(jobs.map((j) => [`${j.platform}/${j.companySlug}`, { platform: j.platform, slug: j.companySlug }])).values(), { platform: 'workday', slug: 'broken.wd5/External' }];
const connectors = Object.fromEntries(PLATFORMS.map((platform) => [platform, {
  platform,
  async fetchJobs(slug) {
    if (slug.startsWith('broken')) throw new HttpError(404, 'https://broken.example');
    return jobs.filter((j) => j.platform === platform && j.companySlug === slug);
  },
}]));

const aggregator = createAggregator(sources, { connectors, log: () => {} });
aggregator.start();
while (!aggregator.progress().ready) await new Promise((r) => setTimeout(r, 20));

const app = buildServer(aggregator, { webRoot });
const port = Number(process.env.PORT ?? 4173);
await app.listen({ port, host: '127.0.0.1' });
console.log(`e2e server ready on http://127.0.0.1:${port} with ${aggregator.all().length} jobs`);
