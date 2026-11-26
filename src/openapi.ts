import { JOB_PARAMS } from './query.js';

const jobSummary = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Job id (bigint serialized as a string).' },
    platform: { type: 'string' }, company_slug: { type: 'string' }, title: { type: 'string' },
    locations: { type: 'array', items: { type: 'string' } },
    remote: { type: ['boolean', 'null'] }, department: { type: ['string', 'null'] },
    employment_type: { type: ['string', 'null'] }, seniority: { type: ['string', 'null'] },
    salary_min: { type: ['string', 'null'], description: 'Numeric, serialized as a string.' },
    salary_max: { type: ['string', 'null'] }, salary_currency: { type: ['string', 'null'] }, salary_text: { type: ['string', 'null'] },
    posted_at: { type: ['string', 'null'], format: 'date-time' }, apply_url: { type: ['string', 'null'] },
    first_seen: { type: 'string', format: 'date-time' }, last_seen: { type: 'string', format: 'date-time' },
    dedupe_key: { type: ['string', 'null'] },
    relevance: { type: 'number', description: 'Only present when q is set. Higher is better; only comparable within one query.' },
  },
} as const;

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' }, message: { type: 'string' } },
} as const;

/** Rendered from JOB_PARAMS so the documented parameters can't drift from what the parser accepts. */
export const openapiSpec = {
  openapi: '3.0.3',
  info: { title: 'job-search API', version: '0.1.0', description: 'Read-only API over jobs aggregated from ATS public endpoints. The server mounts these paths under /api.' },
  paths: {
    '/jobs': {
      get: {
        summary: 'Search and list open jobs',
        description: 'Cursor-paginated. Follow next_cursor until it is null. Unknown or invalid parameters return 400.',
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
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[0-9]+$' } }],
        responses: {
          '200': { description: 'The job. Closed jobs are returned too (check status).', content: { 'application/json': { schema: {
            allOf: [jobSummary, { type: 'object', properties: {
              key: { type: 'string' }, external_id: { type: 'string' }, status: { type: 'string', enum: ['open', 'closed'] },
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
        summary: 'Top filter values with open-job counts (platform, employment_type, seniority, department, location, salary_currency)',
        description: 'Up to 50 values per facet, most common first. Cached for 5 minutes. Values are the platforms\' own labels and are not normalized.',
        responses: { '200': { description: 'Facet values' } },
      },
    },
    '/stats': { get: { summary: 'Job counts per platform, source states and crawl queue depth', responses: { '200': { description: 'Stats' } } } },
    '/health': { get: { summary: 'Liveness + database check', responses: { '200': { description: 'ok' } } } },
    '/openapi.json': { get: { summary: 'This document', responses: { '200': { description: 'OpenAPI 3 spec' } } } },
  },
} as const;
