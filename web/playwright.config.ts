import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const chromium = devices['Desktop Chrome'];

// Every spec runs at all three widths from the plan: phone (base), tablet (md) and desktop (lg).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'phone-375', use: { ...chromium, viewport: { width: 375, height: 812 }, hasTouch: true } },
    { name: 'tablet-768', use: { ...chromium, viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'desktop-1280', use: { ...chromium, viewport: { width: 1280, height: 800 } } },
  ],
  webServer: { command: 'node e2e/serve.mjs', url: `http://127.0.0.1:${PORT}/health`, reuseExistingServer: !process.env.CI, timeout: 60_000, env: { PORT: String(PORT) } },
});
