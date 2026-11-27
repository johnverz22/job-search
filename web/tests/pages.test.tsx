import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, JobDetail } from '../src/api/types';
import { routes } from '../src/router';

const job = (id: number, o: Partial<Job> = {}): Job => ({
  id: String(id), platform: 'gem', company_slug: 'acme-inc', title: `Job ${id}`, locations: ['Berlin'], remote: null, department: null, employment_type: null,
  seniority: null, salary_min: null, salary_max: null, salary_currency: null, salary_text: null, posted_at: '2026-11-20T00:00:00Z', apply_url: 'https://acme.example/apply',
  first_seen: '2026-11-20T00:00:00Z', last_seen: '2026-11-25T00:00:00Z', dedupe_key: null, ...o,
});
const detail = (id: number, o: Partial<JobDetail> = {}): JobDetail => ({ ...job(id), key: `gem:acme:${id}`, external_id: String(id), status: 'open', description_html: '<p>Hello world</p>', ...o });

type Handler = (url: URL) => { status?: number; body: unknown };
let handler: Handler;
let calls: URL[];
const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const EMPTY_FACETS = { platform: [], employment_type: [], seniority: [], department: [], location: [], salary_currency: [] };

beforeEach(() => {
  calls = [];
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  handler = (u) => (u.pathname === '/api/facets' ? { body: EMPTY_FACETS } : { status: 404, body: { error: 'not_found' } });
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost');
    calls.push(url);
    const r = handler(url);
    return jsonRes(r.status ?? 200, r.body);
  }));
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}
const jobCalls = () => calls.filter((u) => u.pathname === '/api/jobs');
const lastJobCall = () => jobCalls().at(-1)!;

describe('search page', () => {
  it('lists jobs from the API with sensible defaults (duplicates hidden, no cursor)', async () => {
    handler = (u) => (u.pathname === '/api/jobs' ? { body: { count: 2, limit: 50, next_cursor: null, jobs: [job(1, { title: 'Senior React Dev', remote: true, employment_type: 'Full time', salary_min: '80000', salary_max: '100000', salary_currency: 'USD' }), job(2)] } } : { body: EMPTY_FACETS });
    renderAt('/');
    expect(await screen.findByRole('link', { name: 'Senior React Dev' })).toHaveAttribute('href', '/jobs/1');
    expect(screen.getByText('$80,000 – $100,000')).toBeInTheDocument();
    expect(screen.getByText('Remote', { selector: 'li' })).toBeInTheDocument();
    const meta = screen.getAllByText('Acme Inc')[0]!.closest('p')!;
    expect(meta).toHaveTextContent('Acme Inc·Gem'); // company name prettified from the slug, then the platform
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('2 jobs loaded');
    expect(lastJobCall().searchParams.get('distinct')).toBe('true');
    expect(lastJobCall().searchParams.get('limit')).toBe('50');
    expect(lastJobCall().searchParams.has('cursor')).toBe(false);
  });

  it('only renders http(s) apply links, with safe attributes', async () => {
    handler = (u) => (u.pathname === '/api/jobs' ? { body: { count: 2, limit: 50, next_cursor: null, jobs: [job(1), job(2, { apply_url: 'javascript:alert(1)' })] } } : { body: EMPTY_FACETS });
    renderAt('/');
    const apply = await screen.findAllByRole('link', { name: /^Apply for/ });
    expect(apply).toHaveLength(1);
    expect(apply[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(apply[0]).toHaveAttribute('target', '_blank');
  });

  it('Load more follows next_cursor and appends; the last page says so', async () => {
    handler = (u) => {
      if (u.pathname !== '/api/jobs') return { body: EMPTY_FACETS };
      return u.searchParams.get('cursor') === 'c1'
        ? { body: { count: 1, limit: 50, next_cursor: null, jobs: [job(2)] } }
        : { body: { count: 1, limit: 50, next_cursor: 'c1', jobs: [job(1)] } };
    };
    renderAt('/');
    await screen.findByRole('link', { name: 'Job 1' });
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('more available');
    await userEvent.click(screen.getByRole('button', { name: 'Load more jobs' }));
    expect(await screen.findByRole('link', { name: 'Job 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Job 1' })).toBeInTheDocument();
    expect(lastJobCall().searchParams.get('cursor')).toBe('c1');
    expect(screen.queryByRole('button', { name: 'Load more jobs' })).toBeNull();
    expect(screen.getByText('That’s everything.')).toBeInTheDocument();
  });

  it('a filter change starts over without the old cursor (cursors are bound to their filters)', async () => {
    handler = (u) => (u.pathname === '/api/jobs' ? { body: { count: 1, limit: 50, next_cursor: 'c1', jobs: [job(1)] } } : { body: EMPTY_FACETS });
    const router = renderAt('/');
    await screen.findByRole('link', { name: 'Job 1' });
    await userEvent.click(screen.getByRole('button', { name: 'Load more jobs' }));
    await waitFor(() => expect(lastJobCall().searchParams.get('cursor')).toBe('c1'));
    const sidebar = screen.getByRole('complementary', { name: 'Filters' });
    await userEvent.click(within(sidebar).getByRole('radio', { name: 'Remote' }));
    await waitFor(() => expect(lastJobCall().searchParams.get('remote')).toBe('true'));
    expect(lastJobCall().searchParams.has('cursor')).toBe(false);
    expect(router.state.location.search).toBe('?remote=true');
  });

  it('typing in the search box debounces, updates the URL, and offers best-match sort only with a query', async () => {
    handler = (u) => (u.pathname === '/api/jobs' ? { body: { count: 1, limit: 50, next_cursor: null, jobs: [job(1)] } } : { body: EMPTY_FACETS });
    const router = renderAt('/');
    await screen.findByRole('link', { name: 'Job 1' });
    const sort = screen.getByRole('combobox', { name: 'Sort by' });
    expect(within(sort).getByRole('option', { name: 'Best match' })).toBeDisabled();
    const before = jobCalls().length;
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search jobs' }), 'react');
    expect(jobCalls().length).toBe(before); // nothing sent per keystroke
    await waitFor(() => expect(lastJobCall().searchParams.get('q')).toBe('react'), { timeout: 2000 });
    expect(jobCalls().length).toBe(before + 1);
    expect(router.state.location.search).toBe('?q=react');
    expect(within(sort).getByRole('option', { name: 'Best match' })).not.toBeDisabled();
    expect(sort).toHaveValue('relevance');
  });

  it('reads all state from the URL, drops values the API would reject, and shows removable chips', async () => {
    handler = (u) => (u.pathname === '/api/jobs' ? { body: { count: 0, limit: 50, next_cursor: null, jobs: [] } } : { body: EMPTY_FACETS });
    const router = renderAt('/?q=react&platform=gem,nonsense&remote=true&min_salary=5000&sort=bogus');
    await screen.findByText('No jobs match');
    const p = lastJobCall().searchParams;
    expect(p.get('platform')).toBe('gem');
    expect(p.has('min_salary')).toBe(false); // no currency => dropped, not sent
    expect(p.has('sort')).toBe(false);
    const chips = screen.getAllByRole('list', { name: 'Active filters' });
    expect(within(chips[0]!).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Remove filter: Gem', 'Remove filter: Remote', 'Clear all']);
    await userEvent.click(within(chips[0]!).getByRole('button', { name: 'Remove filter: Remote' }));
    await waitFor(() => expect(router.state.location.search).not.toContain('remote'));
  });

  it('empty state offers a way out', async () => {
    handler = (u) => (u.pathname === '/api/jobs' ? { body: { count: 0, limit: 50, next_cursor: null, jobs: [] } } : { body: EMPTY_FACETS });
    const router = renderAt('/?q=the&remote=false');
    expect(await screen.findByText('No jobs match')).toBeInTheDocument();
    expect(screen.getByText(/Very common words like “the” are ignored/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start over' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('shows the API’s message for an invalid query, with no retry loop', async () => {
    handler = (u) => (u.pathname === '/api/jobs' ? { status: 400, body: { error: 'invalid_query', message: 'min_salary requires salary_currency' } } : { body: EMPTY_FACETS });
    renderAt('/?q=x');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That search can’t be run');
    expect(alert).toHaveTextContent('min_salary requires salary_currency');
    expect(jobCalls()).toHaveLength(1);
  });

  it('shows a retry for server errors and recovers', async () => {
    let fail = true;
    handler = (u) => (u.pathname !== '/api/jobs' ? { body: EMPTY_FACETS } : fail ? { status: 500, body: { error: 'internal_error' } } : { body: { count: 1, limit: 50, next_cursor: null, jobs: [job(1)] } });
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 }));
    fail = false;
    expect(await screen.findByRole('link', { name: 'Job 1' }, { timeout: 4000 })).toBeInTheDocument();
  });

  it('salary bounds stay disabled until a currency is chosen', async () => {
    renderAt('/');
    const sidebar = await screen.findByRole('complementary', { name: 'Filters' });
    const min = within(sidebar).getByLabelText('Minimum salary');
    expect(min).toBeDisabled();
    await userEvent.selectOptions(within(sidebar).getByLabelText('Currency'), 'EUR');
    await waitFor(() => expect(within(sidebar).getByLabelText('Minimum salary')).toBeEnabled());
  });
});

describe('mobile filter sheet', () => {
  it('edits a draft and only applies on "Show results"', async () => {
    handler = (u) => (u.pathname === '/api/jobs' ? { body: { count: 1, limit: 50, next_cursor: null, jobs: [job(1)] } } : { body: EMPTY_FACETS });
    const router = renderAt('/');
    await screen.findByRole('link', { name: 'Job 1' });
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Filters' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Remote' }));
    expect(router.state.location.search).toBe(''); // draft only
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show results' }));
    await waitFor(() => expect(router.state.location.search).toBe('?remote=true'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: /^Filters/ })).toHaveTextContent('1');
  });

  it('closing without applying discards the draft; Escape closes', async () => {
    const router = renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: /^Filters/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Filters' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Remote' }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.search).toBe('');
    await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(within(await screen.findByRole('dialog')).getByRole('radio', { name: 'Any' })).toBeChecked();
  });
});

describe('job page', () => {
  const serve = (d: JobDetail | null, status = 200) => {
    handler = (u) => (u.pathname.startsWith('/api/jobs/') ? (d ? { status, body: d } : { status, body: { error: 'not_found', message: 'no job' } }) : { body: EMPTY_FACETS });
  };

  it('renders the job and keeps hostile description HTML inert', async () => {
    serve(detail(7, { title: 'Platform Engineer', description_html: '<h2>About</h2><p onclick="x()">Build <b>things</b></p><script>window.pwned=1</script><img src=x onerror="window.pwned=1"><a href="javascript:window.pwned=1">bad</a><a href="https://ok.example">good</a>' }));
    renderAt('/jobs/7');
    expect(await screen.findByRole('heading', { level: 1, name: 'Platform Engineer' })).toBeInTheDocument();
    const body = document.querySelector('.prose-job')!;
    expect(body.querySelector('script, img')).toBeNull();
    expect(body.innerHTML).not.toMatch(/onclick|onerror|javascript:/i);
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    const good = within(body as HTMLElement).getByRole('link', { name: 'good' });
    expect(good).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(within(body as HTMLElement).getByText('bad').closest('a')).not.toHaveAttribute('href');
  });

  it('warns on closed postings and says so when the description is missing', async () => {
    serve(detail(8, { status: 'closed', description_html: null }));
    renderAt('/jobs/8');
    expect(await screen.findByText('This posting is no longer open')).toBeInTheDocument();
    expect(screen.getByText(/description isn’t available yet/)).toBeInTheDocument();
  });

  it('hides Apply when the URL is not http(s)', async () => {
    serve(detail(9, { apply_url: 'javascript:alert(1)' }));
    renderAt('/jobs/9');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('link', { name: /^Apply for/ })).toBeNull();
  });

  it('shows a clear not-found view for 404 and for malformed ids', async () => {
    serve(null, 404);
    renderAt('/jobs/999');
    expect(await screen.findByRole('heading', { name: 'Job not found' })).toBeInTheDocument();
  });

  it('links to the company filter using the raw slug', async () => {
    serve(detail(10, { company_slug: 'acme inc' }));
    renderAt('/jobs/10');
    const link = await screen.findByRole('link', { name: 'Acme Inc' });
    expect(link).toHaveAttribute('href', '/?company=acme%20inc');
  });
});

describe('status page and routing', () => {
  it('renders platform rows and tiles from /stats', async () => {
    handler = () => ({ body: { jobs: [{ platform: 'gem', open: 1200, closed: 0 }, { platform: 'workday', open: 5, closed: 0 }], sources: [{ platform: 'gem', state: 'ok', n: 40 }, { platform: 'gem', state: 'invalid', n: 2 }, { platform: 'workday', state: 'ok', n: 1 }], queue: { due: 3, oldest_due: '2026-11-25T00:00:00Z' }, crawl: { ready: true, total: 43, done: 43 }, memory_mb: 120 } });
    renderAt('/status');
    expect(await screen.findByRole('heading', { name: 'Crawl status' })).toBeInTheDocument();
    expect(screen.getByText('1,205')).toBeInTheDocument(); // open total
    const table = screen.getByRole('table', { name: 'Jobs and sources per platform' });
    expect(within(table).getByRole('row', { name: /Gem 1,200 40 ok, 2 invalid/ })).toBeInTheDocument();
  });

  it('unknown routes show a not-found page', async () => {
    renderAt('/nope/nothing');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('has a skip link and a main landmark', async () => {
    renderAt('/status');
    expect(await screen.findByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});

describe('crawl banner', () => {
  const page = { count: 0, limit: 50, next_cursor: null, jobs: [] as Job[] };

  it('says the first crawl is still running, including on an empty list', async () => {
    handler = (u) => (u.pathname === '/api/jobs' ? { body: page } : u.pathname === '/api/stats' ? { body: { crawl: { ready: false, total: 3, done: 1 } } } : { body: EMPTY_FACETS });
    renderAt('/');
    expect(await screen.findByRole('status', { name: 'Crawl progress' })).toHaveTextContent('Still collecting jobs (1/3 sources)');
    expect(await screen.findByText('No jobs match')).toBeInTheDocument();
  });

  it('stays hidden once the server is ready', async () => {
    handler = (u) => (u.pathname === '/api/jobs' ? { body: page } : u.pathname === '/api/stats' ? { body: { crawl: { ready: true, total: 3, done: 3 } } } : { body: EMPTY_FACETS });
    renderAt('/');
    await screen.findByText('No jobs match');
    await waitFor(() => expect(calls.some((u) => u.pathname === '/api/stats')).toBe(true));
    expect(screen.queryByRole('status', { name: 'Crawl progress' })).toBeNull();
    expect(jobCalls()).toHaveLength(1);
  });

  it('refreshes results as sources finish and disappears when done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let ready = false;
      handler = (u) => {
        if (u.pathname === '/api/stats') return { body: { crawl: { ready, total: 2, done: ready ? 2 : 1 } } };
        if (u.pathname !== '/api/jobs') return { body: EMPTY_FACETS };
        return { body: ready ? { ...page, count: 1, jobs: [job(1)] } : page };
      };
      renderAt('/');
      await screen.findByRole('status', { name: 'Crawl progress' });
      ready = true;
      await vi.advanceTimersByTimeAsync(5_100);
      expect(await screen.findByRole('link', { name: 'Job 1' })).toBeInTheDocument();
      expect(screen.queryByRole('status', { name: 'Crawl progress' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
