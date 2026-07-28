import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const serverURL = new URL(baseURL);
const serverPort = serverURL.port || (serverURL.protocol === 'https:' ? '443' : '80');

export default defineConfig({
  testDir: './scenarios',
  timeout: 120_000,         // 2 minutes per test (Syncfusion cold start is slow)
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    channel: 'chromium',    // New headless mode -- real Chrome rendering engine
    viewport: { width: 1400, height: 900 },
    headless: true,
    video: { mode: 'on', size: { width: 1400, height: 900 } }, // 1:1 pixel mapping with viewport
    screenshot: 'off',      // We take manual screenshots at specific points
  },
  webServer: {
    command: `npm run dev:ui -- --host ${serverURL.hostname} --port ${serverPort} --strictPort`,
    url: baseURL,
    // Debug scenarios use local fixtures/seams. Never let the Vite server
    // inherit a real shared-account auto-login from .env.local.
    env: {
      ...process.env,
      VITE_DEV_AUTO_LOGIN_EMAIL: '',
      VITE_DEV_AUTO_LOGIN_PASSWORD: '',
    },
    reuseExistingServer: false,
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
