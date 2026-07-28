// agent-cli/profile-open.mjs — drive the REAL app (localhost:5173, dev auto-login
// as the heavy-doc owner) and profile the main-thread cost of opening a document.
// Captures longtasks (main-thread blocks) during the open window + app console
// timing, so we can see whether the ~3s freeze is real and what it is.
import { chromium } from 'playwright';
import { assertBrowserUsesLeasedAccount, installLeasedBrowserAccount } from './lib/leased-browser-session.mjs';

const DOC_NAME = process.argv[2] || 'Package 2 - Rev 4 -- IC.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

const logs = [];
let clickWall = null;
page.on('console', (m) => { logs.push({ t: Date.now(), text: m.text() }); });

// Install a longtask + paint observer as early as possible.
await page.addInitScript(() => {
  try { window.__CLOUD_SYNC_DEBUG = true; } catch (_e) {}
  try { window.localStorage.setItem('__cloud_sync_debug', '1'); } catch (_e) {}
  window.__lt = [];
  window.__marks = { navStart: performance.now() };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__lt.push({ start: Math.round(e.startTime), dur: Math.round(e.duration), name: e.name });
    }).observe({ entryTypes: ['longtask'] });
  } catch (_e) {}
  try { window.localStorage.setItem('__force_perf_debug', '1'); } catch (_e) {}
});

console.log('navigating to localhost:5173 (auto-login as dev account)...');
const leasedBrowserAccount = await installLeasedBrowserAccount(page);
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await assertBrowserUsesLeasedAccount(page, { account: leasedBrowserAccount });

// Wait for the dashboard to show document tiles (auto-login completes).
await page.waitForTimeout(4000);
// Try to find the doc tile by its name text.
let opened = false;
const urlBefore = page.url();
try {
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 30000 });
  // reset longtask buffer right before opening so we only measure the OPEN
  await page.evaluate(() => { window.__lt = []; window.__openClickAt = performance.now(); });
  clickWall = Date.now();
  await tile.click();
  await page.waitForTimeout(1500);
  // Did the viewer open? (URL change, or a canvas/back-button appears, or the
  // dashboard "N files" list view is gone.) If not, try a double-click.
  let inViewer = await page.evaluate(() => document.querySelectorAll('canvas').length > 0
    || !!document.querySelector('[class*="viewer" i],[class*="pdf" i]')
    || !document.body.innerText.includes(' files'));
  if (!inViewer) {
    await page.evaluate(() => { window.__lt = []; window.__openClickAt = performance.now(); });
    await tile.dblclick();
    await page.waitForTimeout(1500);
    inViewer = await page.evaluate(() => document.querySelectorAll('canvas').length > 0
      || !document.body.innerText.includes(' files'));
  }
  console.log('urlBefore:', urlBefore, '\nurlAfter :', page.url(), '\ninViewer :', inViewer);
  opened = true;
} catch (e) {
  console.log('could not find/click the doc tile by name:', e.message);
}

if (opened) {
  // Poll until the viewer has rendered a page canvas AND the main thread goes
  // quiet (no new longtask for ~800ms), or timeout at 25s.
  const result = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const start = performance.now();
    let firstCanvasAt = null;
    let lastLtCount = 0;
    let quietSince = null;
    while (performance.now() - start < 25000) {
      const canvases = document.querySelectorAll('canvas');
      let painted = false;
      for (const c of canvases) { if (c.width > 100 && c.height > 100) { painted = true; break; } }
      if (painted && firstCanvasAt == null) firstCanvasAt = performance.now();
      const ltNow = (window.__lt || []).length;
      if (ltNow === lastLtCount) { if (quietSince == null) quietSince = performance.now(); }
      else { quietSince = null; lastLtCount = ltNow; }
      if (firstCanvasAt != null && quietSince != null && performance.now() - quietSince > 800) break;
      await sleep(100);
    }
    const clickAt = window.__openClickAt || start;
    const lt = (window.__lt || []).slice().sort((a, b) => b.dur - a.dur);
    const totalBlockMs = lt.reduce((s, e) => s + e.dur, 0);
    return {
      timeToFirstCanvasMs: firstCanvasAt != null ? Math.round(firstCanvasAt - clickAt) : null,
      settleMs: Math.round(performance.now() - clickAt),
      longtaskCount: lt.length,
      totalMainThreadBlockMs: Math.round(totalBlockMs),
      top10Longtasks: lt.slice(0, 10),
      canvasCount: document.querySelectorAll('canvas').length,
    };
  });
  console.log('\n=== OPEN PROFILE: ' + DOC_NAME + ' ===');
  console.log(JSON.stringify(result, null, 2));
}

console.log('\n=== open timeline (ms after click → console line) ===');
const base = clickWall || (logs[0] && logs[0].t) || Date.now();
const timeline = logs.filter((l) => l.t >= base - 200);
for (const l of timeline) console.log(String(l.t - base).padStart(6) + 'ms  ' + l.text.slice(0, 180));
console.log('\ntotal console lines:', logs.length, '| timeline lines:', timeline.length);

await browser.close();
