import { defineConfig } from '@playwright/test';
// UX regression tests use the branch's existing server; never start a second one.
export default defineConfig({
  testDir: './scenarios', testMatch: 'track-b-polish.spec.mjs', workers: 1,
  timeout: 60000, expect: { timeout: 10000 },
  outputDir: './audit-scratch/track-b/results', reporter: 'list',
  use: { baseURL: 'http://localhost:5230', channel: 'chromium', headless: true,
    viewport: { width: 1400, height: 900 }, screenshot: 'only-on-failure' },
});
