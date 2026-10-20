import { defineConfig, devices } from '@playwright/test';
import { env } from './src/config';

/**
 * Three projects = three layers of the testing pyramid.
 *   unit - pure helpers and oracles, no network, milliseconds.
 *   api  - the bulk of coverage: contracts, validation, access control.
 *   e2e  - a handful of critical user journeys through the real UI.
 */
export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // The target API partly serializes DB access (ENV-02); more parallelism only produces timeouts and 500s.
  workers: 3,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'unit', testDir: 'tests/unit' },
    {
      name: 'api',
      testDir: 'tests/api',
    },
    {
      name: 'e2e',
      testDir: 'tests/e2e',
      workers: 2,
      // Each UI step costs 2-3 API calls of ~1s on the shared deployment (ENV-02);
      // under full-suite load 10s was not enough headroom.
      expect: { timeout: 20_000 },
      use: { ...devices['Desktop Chrome'], baseURL: env.webUrl, locale: 'en-US' },
    },
  ],
});
