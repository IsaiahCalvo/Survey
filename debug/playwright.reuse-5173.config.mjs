import { defineConfig } from '@playwright/test';

// Reuse the already-running Vite on 5173. Do not spawn or kill it.
export default defineConfig({
  testDir: './scenarios',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    channel: 'chromium',
    viewport: { width: 1440, height: 900 },
    headless: true,
  },
  projects: [{ name: 'chromium', use: { channel: 'chromium' } }],
});
