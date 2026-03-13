import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scenarios',
  timeout: 120_000,         // 2 minutes per test (Syncfusion cold start is slow)
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chromium',    // New headless mode -- real Chrome rendering engine
    viewport: { width: 1400, height: 900 },
    headless: true,
    video: 'off',           // Phase 5 doesn't need video yet
    screenshot: 'off',      // We take manual screenshots at specific points
  },
  webServer: {
    command: 'npm run dev:ui',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,       // 2 minutes for Vite cold start with 30+ Syncfusion packages
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { channel: 'chromium' },
    },
  ],
});
