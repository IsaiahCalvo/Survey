// Scratch config for this container: same as debug/playwright.config.mjs but
// launches the PREINSTALLED chromium via executablePath (the pinned
// @playwright/test expects chromium-1217; the container ships 1194 — do not
// run `playwright install`).
import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const serverURL = new URL(baseURL);
const serverPort = serverURL.port || (serverURL.protocol === 'https:' ? '443' : '80');

export default defineConfig({
  testDir: './scenarios',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    viewport: { width: 1400, height: 900 },
    headless: true,
    video: 'off',
    screenshot: 'off',
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
  },
  webServer: {
    command: `npm run dev:ui -- --host ${serverURL.hostname} --port ${serverPort} --strictPort`,
    url: baseURL,
    cwd: '/home/user/Survey',
    env: {
      ...process.env,
      VITE_DEV_AUTO_LOGIN_EMAIL: '',
      VITE_DEV_AUTO_LOGIN_PASSWORD: '',
    },
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
