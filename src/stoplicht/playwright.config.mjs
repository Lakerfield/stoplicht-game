import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for Stoplicht. `npm run test:e2e` starts (or reuses) the dev server on port 9000.
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'html' : 'list',
  use: {
    baseURL: 'http://localhost:9000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, testIgnore: /mobile\.spec\.ts/ },
    // Chromium-based phone emulation (no extra browser download needed)
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  outputDir: 'test-results/',
  webServer: {
    command: 'npx vite --port 9000 --strictPort',
    port: 9000,
    reuseExistingServer: !process.env.CI,
    env: { CI: '1' },
  },
});
