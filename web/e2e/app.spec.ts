import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Breakpoints under test (Tailwind defaults): <1024 uses the filter dialog, >=1024 the sidebar, 768-1023 also shows quick filters.
const width = (page: Page) => page.viewportSize()!.width;
const isLg = (page: Page) => width(page) >= 1024;
const results = (page: Page) => page.getByRole('region', { name: 'Search results' });

async function openJob(page: Page, title: string) {
  await page.goto(`/?q=${encodeURIComponent(title)}`);
  await results(page).getByRole('link', { name: title }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

test.describe('search', () => {
  test('finds a job by text, keeps state in the URL, and Back restores the results', async ({ page }) => {
    await page.goto('/');
    await expect(results(page).getByRole('status')).toContainText('50 jobs loaded');
    await page.getByRole('searchbox', { name: 'Search jobs' }).fill('react');
    await expect(page).toHaveURL(/q=react/);
    const card = results(page).getByRole('link', { name: 'Senior React Developer' });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Senior React Developer' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to results' }).click();
    await expect(page).toHaveURL(/q=react/);
    await expect(page.getByRole('searchbox', { name: 'Search jobs' })).toHaveValue('react');
  });

  test('Load more appends pages until everything is shown', async ({ page }) => {
    await page.goto('/');
    const status = results(page).getByRole('status');
    await expect(status).toContainText('50 jobs loaded');
    await page.getByRole('button', { name: 'Load more jobs' }).click();
    await expect(status).toContainText('100 jobs loaded');
    await page.getByRole('button', { name: 'Load more jobs' }).click();
    await expect(status).toContainText('122 jobs loaded'); // 120 support + react + nodesc; the closed job is never listed
    await expect(page.getByText('That’s everything.')).toBeVisible();
  });

  test('filters: sidebar from lg, dialog below lg; both end up in the URL', async ({ page }) => {
    await page.goto('/');
    if (isLg(page)) {
      await expect(page.getByRole('complementary', { name: 'Filters' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Filters/ })).toBeHidden();
      await page.getByRole('complementary', { name: 'Filters' }).getByRole('radio', { name: 'Remote' }).check();
    } else {
      await expect(page.getByRole('complementary', { name: 'Filters' })).toBeHidden();
      await page.getByRole('button', { name: /^Filters/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Filters' });
      await dialog.getByRole('radio', { name: 'Remote' }).check();
      await expect(page).not.toHaveURL(/remote=/); // still a draft
      await dialog.getByRole('button', { name: 'Show results' }).click();
      await expect(dialog).toBeHidden();
    }
    await expect(page).toHaveURL(/remote=true/);
    await expect(page.getByRole('list', { name: 'Active filters' }).getByRole('button', { name: 'Remove filter: Remote' })).toBeVisible();
    await expect(results(page).getByRole('link', { name: 'Senior React Developer' })).toBeVisible();
  });

  test('md shows quick filters inline; base and lg do not', async ({ page }) => {
    await page.goto('/');
    const w = width(page);
    if (w >= 768 && w < 1024) await expect(page.locator('#quick-remote')).toBeVisible();
    else await expect(page.locator('#quick-remote')).toBeHidden();
  });

  test('"/" focuses search and Escape closes the filter dialog', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Search jobs' })).toBeFocused();
    if (!isLg(page)) {
      await page.getByRole('button', { name: /^Filters/ }).click();
      await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByRole('button', { name: /^Filters/ })).toBeFocused();
    }
  });

  test('empty search shows a way out', async ({ page }) => {
    await page.goto('/?q=zzzznomatchzzzz');
    await expect(page.getByText('No jobs match')).toBeVisible();
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('job page', () => {
  test('renders the description but neutralizes hostile HTML', async ({ page }) => {
    await openJob(page, 'Senior React Developer');
    await expect(page.getByRole('heading', { name: 'About the role' })).toBeVisible();
    await expect(page.locator('.prose-job script, .prose-job img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    await expect(page.locator('.prose-job a', { hasText: 'sneaky' })).not.toHaveAttribute('href', /.+/);
    await expect(page.getByRole('link', { name: /^Apply for Senior React Developer/ }).first()).toHaveAttribute('rel', 'noopener noreferrer');
  });

  // Seeded ids are deterministic (TRUNCATE ... RESTART IDENTITY): 1 = React job, 2 = closed job, 3 = job without a description.
  test('a closed job is flagged and still reachable by deep link (SPA fallback)', async ({ page }) => {
    await page.goto('/jobs/2');
    await expect(page.getByText('This posting is no longer open')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Retired Architect' })).toBeVisible();
  });

  test('a job without a description says so; unknown ids are a clear 404 page', async ({ page }) => {
    await page.goto('/jobs/3');
    await expect(page.getByText(/description isn’t available yet/)).toBeVisible();
    await page.goto('/jobs/99999999');
    await expect(page.getByRole('heading', { name: 'Job not found' })).toBeVisible();
  });

  test('Apply placement follows the breakpoint: sticky bar (base), header (sm, md), side card (lg)', async ({ page }) => {
    await openJob(page, 'Senior React Developer');
    const apply = page.getByRole('link', { name: /^Apply for Senior React Developer/ });
    const visible = await apply.evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === 'fixed').length);
    expect(visible).toBeGreaterThanOrEqual(1);
    if (width(page) < 640) {
      const bar = page.locator('div.fixed.inset-x-0.bottom-0');
      await expect(bar.getByRole('link', { name: /^Apply for/ })).toBeVisible();
    }
  });
});

test.describe('status page', () => {
  test('shows tiles and the platform breakdown', async ({ page }) => {
    await page.goto('/status');
    await expect(page.getByRole('heading', { name: 'Crawl status' })).toBeVisible();
    await expect(page.getByText('Open jobs')).toBeVisible();
    if (width(page) >= 768) await expect(page.getByRole('table', { name: 'Jobs and sources per platform' })).toBeVisible();
    else await expect(page.getByRole('table')).toHaveCount(0);
  });
});

test.describe('content security policy', () => {
  test('no CSP violations while searching, opening a job, and using the filter dialog', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (m) => { if (/content security policy|refused to/i.test(m.text())) violations.push(m.text()); });
    page.on('pageerror', (e) => violations.push(e.message));
    await page.goto('/');
    await expect(results(page).getByRole('status')).toBeVisible();
    if (!isLg(page)) {
      await page.getByRole('button', { name: /^Filters/ }).click();
      await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
      // The dialog must lock page scroll (this is the style injection a too-strict style-src would block).
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
      await page.keyboard.press('Escape');
    }
    await page.goto('/jobs/1');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(violations).toEqual([]);
  });
});

test.describe('layout rules at every width', () => {
  for (const path of ['/', '/status', '/?q=react']) {
    test(`no horizontal page scroll on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('touch targets are at least 44px below lg', async ({ page }) => {
    test.skip(isLg(page), 'dense layout from lg');
    await page.goto('/');
    await expect(results(page).getByRole('status')).toBeVisible();
    for (const target of [page.getByRole('button', { name: /^Filters/ }), page.getByRole('button', { name: 'Load more jobs' }), page.getByRole('searchbox', { name: 'Search jobs' }), page.getByRole('link', { name: 'Status' })]) {
      const box = (await target.boundingBox())!;
      expect(box.height, await target.evaluate((e) => e.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(43.5);
    }
  });

  test('text inputs are 16px (no iOS zoom) below lg', async ({ page }) => {
    test.skip(isLg(page), 'dense layout from lg');
    await page.goto('/');
    expect(await page.getByRole('searchbox', { name: 'Search jobs' }).evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  });

  test('sends security headers', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers()['x-frame-options']).toBe('DENY');
  });
});

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const path of ['/', '/status', '/?q=react&remote=true']) {
      test(`${path} in ${scheme} mode`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        await expect(page.locator('main')).toBeVisible();
        await page.waitForLoadState('networkidle');
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      });
    }
  }

  test('job page and filter dialog have no violations', async ({ page }) => {
    await openJob(page, 'Senior React Developer');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations.map((v) => v.id)).toEqual([]);
    if (!isLg(page)) {
      await page.goto('/');
      await page.getByRole('button', { name: /^Filters/ }).click();
      await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations.map((v) => v.id)).toEqual([]);
    }
  });
});
