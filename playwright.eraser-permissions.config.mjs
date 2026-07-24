import { defineConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { loadEnv } from 'vite';

function mainRepositoryRoot() {
  const commonGitDir = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' },
  ).trim();
  return commonGitDir.endsWith('/.git') ? dirname(commonGitDir) : process.cwd();
}

const envRoot = process.env.ERASER_PERMISSION_E2E_ENV_ROOT
  ? resolve(process.env.ERASER_PERMISSION_E2E_ENV_ROOT)
  : mainRepositoryRoot();
const testEnv = loadEnv('test', envRoot, '');
const required = [
  'SUPABASE_TEST_URL',
  'SUPABASE_TEST_ANON_KEY',
  'SUPABASE_TEST_SERVICE_KEY',
];
for (const name of required) {
  if (!testEnv[name]) {
    throw new Error(
      `[ERASER_E2E_INFRA] Missing ${name} in ${resolve(envRoot, '.env.test')}; suite never skips.`,
    );
  }
}

const testHost = new URL(testEnv.SUPABASE_TEST_URL).hostname;
if (!['localhost', '127.0.0.1', 'zgdkyslxbkusexmkfvgd.supabase.co'].includes(testHost)) {
  throw new Error(`[ERASER_E2E_INFRA] Refusing non-test Supabase host "${testHost}".`);
}

const baseUrl = process.env.ERASER_E2E_BASE_URL || 'http://127.0.0.1:5178';
Object.assign(process.env, {
  ERASER_PERMISSION_E2E: '1',
  ERASER_E2E_BASE_URL: baseUrl,
  SUPABASE_TEST_URL: testEnv.SUPABASE_TEST_URL,
  SUPABASE_TEST_ANON_KEY: testEnv.SUPABASE_TEST_ANON_KEY,
  SUPABASE_TEST_SERVICE_KEY: testEnv.SUPABASE_TEST_SERVICE_KEY,
});

export default defineConfig({
  testDir: './tests/phase35-e2e',
  testMatch: 'collaborator-eraser-scope.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: baseUrl,
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'vite --host 127.0.0.1 --port 5178 --strictPort',
    url: baseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: testEnv.SUPABASE_TEST_URL,
      VITE_SUPABASE_ANON_KEY: testEnv.SUPABASE_TEST_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: testEnv.SUPABASE_TEST_SERVICE_KEY,
    },
  },
});
