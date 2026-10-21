// Speed budget: time to Home and to the first drawn page, measured on a
// PRODUCTION build (vite build + vite preview) against the local Supabase
// stack. Runs after the signed-in suite in .github/workflows/e2e-signed-in.yml.
// Needs `npm run e2e:stack:up` first. Budgets: tests/e2e-speed/budget.mjs.
import base from './playwright.e2e-signed-in.config.mjs';

export const SPEED_PORT = 5196;
const OUT_DIR = 'dist-speed';

export default {
  ...base,
  testDir: './tests/e2e-speed',
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/e2e-speed',
  timeout: 180_000,
  use: { ...base.use, baseURL: `http://127.0.0.1:${SPEED_PORT}` },
  webServer: {
    ...base.webServer,
    command: `npx vite build --mode e2e --outDir ${OUT_DIR} && npx vite preview --mode e2e --outDir ${OUT_DIR} --host 127.0.0.1 --port ${SPEED_PORT} --strictPort`,
    url: `http://127.0.0.1:${SPEED_PORT}`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
};
