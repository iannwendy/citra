import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for Essay Integrity Checker E2E Tests
 *
 * - Default `chromium` project runs offline/local E2E specs and excludes live
 *   `prod-live-verification.spec.ts` so `npm run test:e2e` does not hit production.
 * - `prod-smoke` project runs `prod-live-verification.spec.ts` explicitly via
 *   `npx playwright test --project=prod-smoke`.
 */

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['**/prod-live-verification.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  timeout: 60000,
  projects: [
    {
      name: 'chromium',
      testIgnore: ['**/prod-live-verification.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'prod-smoke',
      testMatch: /prod-live-verification\.spec\.ts/,
      testIgnore: [],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.PLAYWRIGHT_PROD_URL || 'https://citra.io.vn',
      },
    },
  ],
  outputDir: 'test-results/',
});
