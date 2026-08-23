import { defineConfig } from '@playwright/test';

// Reuse a live Vite (`npm run dev:ui`). Do not spawn Electron.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';

export default defineConfig({
  testDir: './scenarios',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    channel: 'chromium',
    viewport: { width: 1400, height: 900 },
    headless: true,
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { channel: 'chromium' },
    },
  ],
});
