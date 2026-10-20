// Signed-in E2E suite against the LOCAL Supabase stack (docs/E2E-SIGNED-IN.md).
// Needs `npm run e2e:stack:up` first; `npm run test:e2e:signed-in` reseeds and
// runs it. Not part of `npm test` (it needs Docker).
import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_BASE_URL } from './tests/e2e-signed-in/accounts.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(ROOT, '.env.e2e');

function readEnvFile() {
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error('[E2E_SIGNED_IN] .env.e2e is missing. Run `npm run e2e:stack:up` first.');
  }
  const env = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

const env = readEnvFile();
const supabaseHost = new URL(env.VITE_SUPABASE_URL).hostname;
if (!['127.0.0.1', 'localhost'].includes(supabaseHost)) {
  throw new Error(`[E2E_SIGNED_IN] refusing non-local Supabase host "${supabaseHost}".`);
}
// Specs read these (signed-in API probes, admin resets).
process.env.E2E_SUPABASE_URL = env.VITE_SUPABASE_URL;
process.env.E2E_SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
process.env.E2E_SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// Claude cloud containers ship a Chromium that may not match the pinned
// @playwright/test build; CI installs the matching one instead.
const localChromium = process.env.PW_CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const port = new URL(E2E_BASE_URL).port;

export default defineConfig({
  testDir: './tests/e2e-signed-in',
  testMatch: '*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: 'playwright-report-e2e', open: 'never' }]]
    : 'list',
  outputDir: 'test-results/e2e-signed-in',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: E2E_BASE_URL,
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: localChromium ? { executablePath: localChromium } : {},
  },
  webServer: {
    command: `npx vite --mode e2e --host 127.0.0.1 --port ${port} --strictPort`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY,
      VITE_TURNSTILE_SITE_KEY: '',
      SURVEY_DEV_AUTH_DISABLED: '1',
      VITE_DEV_AUTO_LOGIN_EMAIL: '',
      VITE_DEV_AUTO_LOGIN_PASSWORD: '',
    },
  },
});
