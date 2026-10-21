// How long a signed-in person waits, on a production build: from typing the
// address to seeing Home, from opening a small document to seeing its first
// page, and from opening a big drawing set (240 pages, 4,000 markups, seeded by
// scripts/perf/big-doc-seed.mjs) to its first page and to its markups. Best of
// three cold runs (fresh browser cache each time), checked against
// tests/e2e-speed/budget.mjs.
import fs from 'node:fs';
import { E2E_ACCOUNTS } from '../e2e-signed-in/accounts.mjs';
import { expect, openSampleDocument, profileChip, signIn, test } from '../e2e-signed-in/helpers.mjs';
import { SPEED_BUDGET_MS } from './budget.mjs';

const RUNS = 3;
const BIG_DOC_NAME = 'Big Drawing Set.pdf';

test.describe.configure({ timeout: 600_000 });
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

const LABELS = {
  home: 'Address to Home',
  firstPage: 'Open to first page',
  bigFirstPage: 'Big drawing: open to first page',
  bigMarks: 'Big drawing: open to its markups',
};

// True once page 1's markup layer shows at least one shape.
function pageOneHasMarks() {
  return Boolean(document.querySelector('[data-overlay-page="1"] svg :is(path, rect, ellipse, text, foreignObject)'));
}

// True once page 1's canvas holds a drawn (non-white, non-clear) pixel.
function pageOneHasInk() {
  const canvas = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"] canvas');
  if (!canvas || !canvas.width || !canvas.height) return false;
  const probe = document.createElement('canvas');
  probe.width = 200;
  probe.height = Math.max(1, Math.round((200 * canvas.height) / canvas.width));
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
  const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200)) return true;
  }
  return false;
}

test('Home, a small document and a big drawing set open within the speed budget', async ({ browser, page, baseURL }) => {
  const account = E2E_ACCOUNTS.owner;
  await signIn(page, account);
  const storageState = await page.context().storageState();

  const coldContext = async () => {
    const context = await browser.newContext({ baseURL, storageState, viewport: { width: 1400, height: 900 } });
    await context.route(
      (url) => !['data:', 'blob:'].includes(url.protocol) && !LOCAL_HOSTS.has(url.hostname),
      (route) => route.abort('blockedbyclient'),
    );
    return context;
  };

  const times = { home: [], firstPage: [], bigFirstPage: [], bigMarks: [] };
  for (let run = 0; run < RUNS; run += 1) {
    const context = await coldContext();
    const cold = await context.newPage();
    let start = Date.now();
    await cold.goto('/', { waitUntil: 'commit' });
    await expect(profileChip(cold, account)).toBeVisible({ timeout: 60_000 });
    times.home.push(Date.now() - start);
    start = Date.now();
    await openSampleDocument(cold);
    // The canvas mounts blank before pdf.js draws into it, so wait for ink.
    await expect.poll(() => cold.evaluate(pageOneHasInk), { timeout: 60_000, intervals: [50] }).toBe(true);
    times.firstPage.push(Date.now() - start);

    await context.close();

    // The big drawing set, opened from Home in its own cold context.
    const bigContext = await coldContext();
    const big = await bigContext.newPage();
    await big.goto('/', { waitUntil: 'commit' });
    await expect(profileChip(big, account)).toBeVisible({ timeout: 60_000 });
    await big.getByText(BIG_DOC_NAME, { exact: true }).filter({ visible: true }).first().click();
    start = Date.now();
    await big.getByRole('button', { name: 'Open file' }).first().click();
    await expect.poll(() => big.evaluate(pageOneHasInk), { timeout: 90_000, intervals: [50] }).toBe(true);
    times.bigFirstPage.push(Date.now() - start);
    await expect.poll(() => big.evaluate(pageOneHasMarks), { timeout: 90_000, intervals: [50] }).toBe(true);
    times.bigMarks.push(Date.now() - start);
    await bigContext.close();
  }

  const best = Object.fromEntries(Object.entries(times).map(([key, list]) => [key, Math.min(...list)]));
  const rows = Object.keys(SPEED_BUDGET_MS).map((key) => `| ${LABELS[key]} | ${best[key]} ms | ${times[key].join(', ')} | ${SPEED_BUDGET_MS[key]} ms |`);
  const report = ['### App speed (production build, local backend)', '', '| | Best | All runs | Budget |', '| --- | --- | --- | --- |', ...rows, ''].join('\n');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);

  for (const key of Object.keys(SPEED_BUDGET_MS)) {
    expect(best[key], `${key} took ${best[key]} ms at best; the budget is ${SPEED_BUDGET_MS[key]} ms`).toBeLessThanOrEqual(SPEED_BUDGET_MS[key]);
  }
});
