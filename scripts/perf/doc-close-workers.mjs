#!/usr/bin/env node
// Open/close leak check on the LOCAL e2e stack. Serve a build of the app the
// same way as big-doc-open.mjs, then:
//
//   BASE=http://127.0.0.1:5241 CYCLES=6 node scripts/perf/doc-close-workers.mjs
//
// Signs in as the e2e owner, then CYCLES times opens a document from Home,
// waits for page 1 to be drawn, and closes it again. After every close (and a
// forced GC) it records:
//   workers   - dedicated web workers still alive in the page (pdf.js starts
//               one per opened document; a closed document should give it back)
//   heapMB    - main-thread JS heap
//   rssMB     - resident memory of every renderer process of this browser
//               (the page and its workers' heaps live there)
// and per cycle openMs, from the "Open file" click to page 1 drawn.
// DOC_NAME picks the document (default: the 240-sheet big drawing set).
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:5241';
const CYCLES = Number(process.env.CYCLES || 6);
const DOC_NAME = process.env.DOC_NAME || 'Big Drawing Set.pdf';
const SETTLE_MS = Number(process.env.SETTLE_MS || 2500);
const exe = process.env.PW_CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const PROBE = () => {
  const w = window;
  w.__cycle = { t0: null, drawn: null };
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('button');
    if (button && /Open file/.test(button.getAttribute('aria-label') || button.textContent || '')) {
      w.__cycle.t0 = performance.now();
      w.__cycle.drawn = null;
    }
  }, true);
  const tick = () => {
    const s = w.__cycle;
    if (s.t0 != null && s.drawn == null) {
      const canvas = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"] canvas.survey-pdfjs-page-canvas');
      if (canvas && canvas.width > 0 && !(canvas.width === 300 && canvas.height === 150)) s.drawn = performance.now();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

function rssOf(pid) {
  try {
    const m = /VmRSS:\s+(\d+)\s+kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) / 1024 : 0;
  } catch { return 0; }
}

async function sample(page, browserCdp) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  await cdp.send('HeapProfiler.collectGarbage');
  const heapMB = (await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6;
  await cdp.detach();
  const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
  const rssMB = processInfo.filter((p) => p.type === 'renderer').reduce((sum, p) => sum + rssOf(p.id), 0);
  const kinds = {};
  for (const w of page.workers()) {
    const name = (w.url().split('/').pop() || 'blob').replace(/-[\w-]{8}\.(m?js)$/, '.$1').replace(/^blob:.*/, 'blob');
    kinds[name] = (kinds[name] || 0) + 1;
  }
  return { workers: page.workers().length, heapMB, rssMB, kinds: Object.entries(kinds).map(([k, n]) => `${k}:${n}`).join(',') || '-' };
}

const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}=${typeof v === 'number' ? Math.round(v) : v}`).join(' ');

const browser = await chromium.launch({ executablePath: exe });
const browserCdp = await browser.newBrowserCDPSession();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
// Loopback only: the harness must never reach a real host.
await context.route((u) => !['data:', 'blob:'].includes(u.protocol) && !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort('blockedbyclient'));
await context.addInitScript(PROBE);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e?.message || e).slice(0, 160)));
// Console errors that mention a destroyed worker / transport (a render or
// page fetch that outlived its document).
const destroyedErrors = [];
page.on('console', (m) => { if (m.type() === 'error' && /destroy|sendWithPromise|Transport/i.test(m.text())) destroyedErrors.push(m.text().slice(0, 160)); });

await page.goto(`${BASE}/`);
const dialog = page.getByRole('dialog', { name: 'Welcome back' });
await dialog.waitFor({ timeout: 60_000 });
await dialog.getByLabel('Email').fill('e2e-owner@example.com');
await dialog.getByLabel('Password').fill('E2e-local-only-123!');
await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
await dialog.waitFor({ state: 'hidden', timeout: 60_000 });
const row = () => page.getByText(DOC_NAME, { exact: true }).filter({ visible: true }).first();
await row().waitFor({ timeout: 60_000 });
await page.waitForTimeout(SETTLE_MS);
const base = await sample(page, browserCdp);
console.log('home   ', fmt(base));

const rows = [];
for (let i = 1; i <= CYCLES; i += 1) {
  await row().click();
  await page.getByRole('button', { name: 'Open file' }).first().click();
  await page.waitForFunction(() => window.__cycle.drawn != null, null, { timeout: 120_000, polling: 50 });
  const openMs = await page.evaluate(() => window.__cycle.drawn - window.__cycle.t0);
  const open = await sample(page, browserCdp);
  await page.waitForTimeout(SETTLE_MS);
  await page.getByRole('button', { name: `Close ${DOC_NAME}` }).first().click();
  await row().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(SETTLE_MS);
  const closed = await sample(page, browserCdp);
  rows.push({ openMs, ...closed });
  console.log(`cycle ${i}`, fmt({ openMs, workersOpen: open.workers, ...closed }));
}
await context.close();
await browser.close();

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const last = rows[rows.length - 1];
console.log('SUMMARY', JSON.stringify({
  cycles: CYCLES,
  workersAtHome: base.workers,
  workersAfter: last.workers,
  heapGrowMB: Math.round((last.heapMB - base.heapMB) * 10) / 10,
  rssGrowMB: Math.round(last.rssMB - base.rssMB),
  openMsMedian: Math.round(median(rows.map((r) => r.openMs))),
  pageErrors: errors.length,
  destroyedConsoleErrors: destroyedErrors.length,
}));
if (destroyedErrors.length) console.log('console errors:', [...new Set(destroyedErrors)].join(' | '));
if (errors.length) console.log('page errors:', [...new Set(errors)].join(' | '));
