#!/usr/bin/env node
// Text search speed on the LOCAL e2e stack (seed a real drawing set first:
// BIG_DOC_PDF=debug/fixtures/se011.pdf BIG_DOC_HOT_PAGES=99 node scripts/perf/big-doc-seed.mjs).
// Serve a build (`npx vite build --mode e2e --outDir <dir>` + `npx vite preview
// --mode e2e --outDir <dir> --port 5241`), then:
//
//   BASE=http://127.0.0.1:5241 QUERIES=corridor,output node scripts/perf/text-search-timing.mjs
//
// Cold context, signs in as the e2e owner, opens the document, waits for page 1
// and then WAIT_MS more (how long you look at the sheet before searching),
// presses Ctrl+F and types each query. For each query it reports, in ms after
// the last key:
//   firstRow - the first result row is in the list
//   done     - the search finished ("Searching…" gone, count shown)
//   count    - the status text at the end
// NET=<latency ms>/<down Mbps> throttles the page's network.
// PROFILE=<file.cpuprofile> saves a CPU profile of the last query.
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:5241';
const DOC_NAME = process.env.BIG_DOC_NAME || 'Big Drawing Set.pdf';
const QUERIES = (process.env.QUERIES || 'corridor,output').split(',');
const WAIT_MS = Number(process.env.WAIT_MS || 2000);
const RUNS = Number(process.env.RUNS || 1);
const NET = process.env.NET || null;
// PROFILE=<file.cpuprofile>: CPU profile of the last query.
const PROFILE = process.env.PROFILE || null;
const exe = process.env.PW_CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

async function run(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Local e2e stack accounts only; every non-local request is aborted.
  await context.route((u) => !['data:', 'blob:'].includes(u.protocol) && !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort('blockedbyclient'));
  const page = await context.newPage();
  if (NET) {
    const [latency, mbps] = NET.split('/').map(Number);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: mbps * 125000, uploadThroughput: mbps * 125000 });
  }
  await page.goto(`${BASE}/`);
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await dialog.waitFor({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill('e2e-owner@example.com');
  await dialog.getByLabel('Password').fill('E2e-local-only-123!');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 60_000 });
  await page.getByText(DOC_NAME, { exact: true }).filter({ visible: true }).first().click();
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Open file' }).first().click();
  // Page 1 drawn: its canvas grew past the default size.
  await page.waitForFunction(() => [...document.querySelectorAll('.survey-pdfjs-page-div canvas')].some((c) => c.width > 300), null, { timeout: 120_000, polling: 50 });
  const firstPage = Date.now() - t0;
  const pageAt = await page.evaluate(() => performance.now());
  await page.waitForTimeout(WAIT_MS);
  await page.mouse.click(720, 500);
  await page.keyboard.press('Control+f');
  await page.waitForFunction(() => document.activeElement?.matches?.('.search-text-panel__input'), null, { timeout: 30_000 });
  const out = { firstPage };
  for (const query of QUERIES) {
    await page.locator('.search-text-panel__input').fill('');
    await page.waitForTimeout(300);
    const profiling = PROFILE && query === QUERIES[QUERIES.length - 1];
    let cdp = null;
    if (profiling) {
      cdp = await context.newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
      await cdp.send('Profiler.start');
    }
    const t = await page.evaluate(() => performance.now());
    await page.keyboard.type(query, { delay: 0 });
    const typedAt = await page.evaluate(() => performance.now());
    const r = await page.evaluate(({ typedAt, query }) => new Promise((resolve) => {
      const res = { typingMs: Math.round(typedAt - 0) };
      const tick = () => {
        const now = performance.now();
        const input = document.querySelector('.search-text-panel__input');
        const rows = document.querySelectorAll('.search-text-group');
        if (res.firstRow == null && rows.length && input?.value === query) res.firstRow = Math.round(now - typedAt);
        const status = document.querySelector('.search-text-panel__status')?.getAttribute('data-search-status');
        const count = document.querySelector('.search-text-panel__count')?.textContent || '';
        // Done = results shown, not searching, and nothing changed for 1.5 s
        // (reported at the last change).
        const key = `${status}|${count}|${rows.length}`;
        if (key !== res.lastKey) { res.lastKey = key; res.lastChange = now; }
        if (res.firstRow != null && status === 'results' && now - res.lastChange > 1500) {
          res.done = Math.round(res.lastChange - typedAt);
          res.count = count;
          delete res.lastKey; delete res.lastChange;
          resolve(res);
          return;
        }
        if (now - typedAt > 120_000) { res.timeout = true; res.count = count; resolve(res); return; }
        requestAnimationFrame(tick);
      };
      tick();
    }), { typedAt, query });
    delete r.typingMs;
    // RECTS=1: steps to a few matches and lists the highlight boxes drawn
    // (page, x, y, w, h in page units), to compare two builds.
    if (process.env.RECTS) {
      r.rects = [];
      for (const index of [0, 7, 25, 60, 110]) {
        const row = page.locator(`[data-result-index="${index}"]`).first();
        if (!(await row.count())) continue;
        await row.click();
        await page.waitForTimeout(2500);
        r.rects.push(...await page.evaluate(() => [...document.querySelectorAll('.search-highlight-svg-rect')].map((el) => {
          const host = el.closest('.survey-pdfjs-page-div');
          return [host?.id || '?', ...['x', 'y', 'width', 'height'].map((a) => Math.round(Number(el.getAttribute(a)) * 10) / 10)].join(':');
        })));
      }
      r.rects = [...new Set(r.rects)].sort();
    }
    out[query] = r;
  }
  // When the viewer's read-ahead of the text finished, ms after page 1.
  out.textReadAfterPage1 = await page.evaluate((at) => {
    const mark = performance.getEntriesByName('survey-search-text-read')[0];
    return mark ? Math.round(mark.startTime - at) : null;
  }, pageAt);
  await context.close();
  return out;
}

const browser = await chromium.launch({ executablePath: exe });
for (let i = 0; i < RUNS; i += 1) console.log(JSON.stringify(await run(browser)));
await browser.close();
