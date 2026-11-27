import { JOB_PARAMS } from './query.js';

const jobSummary = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Job id: 12 hexadecimal characters, stable across restarts.' },
    platform: { type: 'string' }, company_slug: { type: 'string' }, title: { type: 'string' },
    locations: { type: 'array', items: { type: 'string' } },
    remote: { type: ['boolean', 'null'] }, department: { type: ['string', 'null'] },
    employment_type: { type: ['string', 'null'] }, seniority: { type: ['string', 'null'] },
    salary_min: { type: ['string', 'null'], description: 'Numeric, serialized as a string.' },
    salary_max: { type: ['string', 'null'] }, salary_currency: { type: ['string', 'null'] }, salary_text: { type: ['string', 'null'] },
    posted_at: { type: ['string', 'null'], format: 'date-time' }, apply_url: { type: ['string', 'null'] },
    first_seen: { type: 'string', format: 'date-time' }, last_seen: { type: 'string', format: 'date-time' },
    dedupe_key: { type: ['string', 'null'] },
    relevance: { type: 'number', description: 'Only present when sorting by relevance. Higher is better; only comparable within one query.' },
  },
} as const;

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' }, message: { type: 'string' } },
} as const;

/** Rendered from JOB_PARAMS so the documented parameters can't drift from what the parser accepts. */
export const openapiSpec = {
  openapi: '3.0.3',
  info: { title: 'job-search API', version: '0.1.0', description: 'Read-only API over jobs aggregated from ATS public endpoints and held in memory (a restart empties the list until the next crawl). The server mounts these paths under /api.' },
  paths: {
    '/jobs': {
      get: {
        summary: 'Search and list jobs',
        description: 'Cursor-paginated: follow next_cursor until it is null; a cursor is only valid for the filters and sort that issued it. Unknown or invalid parameters return 400. '
          + 'Search syntax: words are matched as word prefixes with light suffix stripping and must all match (one or two letter words must match whole); stop words are ignored; '
          + '"quoted phrase" matches literally; -term excludes; "or" separates alternatives. Title, department, company and description are searched. A query of only stop words returns nothing.',
        parameters: Object.entries(JOB_PARAMS).map(([name, schema]) => {
          const { description, ...s } = schema as { description: string } & Record<string, unknown>;
          return { name, in: 'query', required: false, description, schema: s };
        }),
        responses: {
          '200': {
            description: 'A page of jobs',
            content: { 'application/json': { schema: { type: 'object', properties: {
              count: { type: 'integer' }, limit: { type: 'integer' },
              offset: { type: 'integer', description: 'Only echoed when the deprecated offset parameter was used.' },
              next_cursor: { type: ['string', 'null'], description: 'Pass as cursor for the next page; null on the last page.' },
              jobs: { type: 'array', items: jobSummary },
            } } } },
          },
          '400': { description: 'Invalid query', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/jobs/{id}': {
      get: {
        summary: 'Get one job, including its full description',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[0-9a-f]{12}$' } }],
        responses: {
          '200': { description: 'The job. status is always "open": a posting that disappears is removed.', content: { 'application/json': { schema: {
            allOf: [jobSummary, { type: 'object', properties: {
              key: { type: 'string' }, external_id: { type: 'string' }, status: { type: 'string', enum: ['open'] },
              description_html: { type: ['string', 'null'] },
            } }],
          } } } },
          '400': { description: 'Malformed id', content: { 'application/json': { schema: errorSchema } } },
          '404': { description: 'No such job', content: { 'application/json': { schema: errorSchema } } },
        },
      },
    },
    '/facets': {
      get: {
        summary: 'Top filter values with job counts (platform, employment_type, seniority, department, location, salary_currency)',
        description: 'Up to 50 values per facet, most common first. Browsers may cache for 5 minutes once the first crawl is complete. Values are the platforms\' own labels and are not normalized.',
        responses: { '200': { description: 'Facet values' } },
      },
    },
    '/stats': {
      get: {
        summary: 'Job counts, source states, crawl progress and memory use',
        responses: { '200': { description: 'Stats', content: { 'application/json': { schema: { type: 'object', properties: {
          jobs: { type: 'array', items: { type: 'object', properties: { platform: { type: 'string' }, open: { type: 'integer' }, closed: { type: 'integer', description: 'Always 0.' } } } },
          sources: { type: 'array', items: { type: 'object', properties: { platform: { type: 'string' }, state: { type: 'string', enum: ['ok', 'pending', 'failing', 'invalid'] }, n: { type: 'integer' } } } },
          queue: { type: 'object', properties: { due: { type: 'integer', description: 'Sources due now.' }, oldest_due: { type: ['string', 'null'], format: 'date-time' } } },
          crawl: { type: 'object', properties: { ready: { type: 'boolean', description: 'Every source has been attempted once.' }, total: { type: 'integer' }, done: { type: 'integer' } } },
          memory_mb: { type: 'integer' },
        } } } } } },
      },
    },
    '/health': { get: { summary: 'Liveness (does not wait for the first crawl); also served at the root', responses: { '200': { description: 'ok' } } } },
    '/openapi.json': { get: { summary: 'This document', responses: { '200': { description: 'OpenAPI 3 spec' } } } },
  },
} as const;
