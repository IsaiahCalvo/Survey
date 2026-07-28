// agent-cli/verify-interaction-diag.mjs — drive the REAL app, open a doc, then
// programmatically switch tools + do a pan drag + an eraser swipe on the page,
// and report which [InteractionDiag] markers fired. Best-effort verification of
// the instrumentation only (NOT a behavior assertion).
import { chromium } from 'playwright';
import { assertBrowserUsesLeasedAccount, installLeasedBrowserAccount } from './lib/leased-browser-session.mjs';

const DOC_NAME = process.argv[2] || 'Package 2 - Rev 4 -- IC.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

const diag = [];
const allLogs = [];
page.on('console', (m) => {
  const text = m.text();
  allLogs.push(text);
  if (text.includes('[InteractionDiag]')) diag.push(text);
});

console.log('navigating to localhost:5173 (auto-login)...');
const leasedBrowserAccount = await installLeasedBrowserAccount(page);
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await assertBrowserUsesLeasedAccount(page, { account: leasedBrowserAccount });
await page.waitForTimeout(4000);

try {
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 30000 });
  await tile.click();
  await page.waitForTimeout(1500);
  let inViewer = await page.evaluate(() => document.querySelectorAll('canvas').length > 0);
  if (!inViewer) { await tile.dblclick(); await page.waitForTimeout(1500); }
  console.log('opened viewer:', page.url());
} catch (e) {
  console.log('could not open doc tile:', e.message);
  await browser.close();
  process.exit(1);
}

// Wait for the loading curtain to lift (interactive-ready marker).
await page.waitForTimeout(6000);

// --- Drive tool switches via the toolbar buttons (Pan / Select) ---
async function clickToolByTitleOrText(names) {
  for (const n of names) {
    try {
      const btn = page.getByText(n, { exact: true }).first();
      if (await btn.count()) { await btn.click({ timeout: 1500 }); return n; }
    } catch (_e) { /* try next */ }
  }
  return null;
}

// Toolbar tool buttons render an Icon; the accessible text may be a tooltip.
// Easiest reliable path: dispatch through the exposed bottom-toolbar buttons by
// their tooltip label is unreliable headless, so click by button index in the
// pan/select group. Fall back to keyboard 'v'/'h' if present. We at least try.
try {
  const buttons = await page.$$('button.btn-icon');
  if (buttons.length >= 2) {
    await buttons[1].click(); // second icon-button in the first group = Select
    await page.waitForTimeout(400);
    await buttons[0].click(); // first = Pan
    await page.waitForTimeout(400);
  }
} catch (e) { console.log('toolbar click fallback failed:', e.message); }

// --- Pan drag on the page (pan is the default tool) ---
try {
  const box = await page.evaluate(() => {
    const el = document.querySelector('.e-pv-viewer-container, [class*="viewer" i], canvas');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (box) {
    await page.mouse.move(box.x, box.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(box.x - i * 12, box.y - i * 10); await page.waitForTimeout(40); }
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
} catch (e) { console.log('pan drag failed:', e.message); }

// --- Switch to eraser and swipe (best-effort; eraser button may be in a dropdown) ---
try {
  await page.evaluate(() => {
    // Try every API surface the app exposes to flip the tool to eraser.
    const apis = [window.__bottomToolbarApi, window.bottomToolbarApi];
    for (const a of apis) { if (a && typeof a.setActiveTool === 'function') { a.setActiveTool('eraser'); return; } }
  });
  await page.waitForTimeout(600);
  const box = await page.evaluate(() => {
    const el = document.querySelector('canvas');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (box) {
    await page.mouse.move(box.x - 40, box.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) { await page.mouse.move(box.x - 40 + i * 16, box.y + i * 4); await page.waitForTimeout(40); }
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
} catch (e) { console.log('eraser swipe failed:', e.message); }

await page.waitForTimeout(1000);

console.log('\n=== [InteractionDiag] lines captured (' + diag.length + ') ===');
for (const l of diag) console.log('  ' + l);

// Also pull the in-page buffer if present.
const bufLines = await page.evaluate(() => {
  const buf = window.__consoleLogBuffer;
  if (!Array.isArray(buf)) return [];
  return buf.map((e) => (typeof e === 'string' ? e : (e && e.text) || JSON.stringify(e)))
    .filter((s) => s.includes('[InteractionDiag]'));
});
console.log('\n=== [InteractionDiag] from window.__consoleLogBuffer (' + bufLines.length + ') ===');
for (const l of bufLines.slice(0, 60)) console.log('  ' + l);

console.log('\ntotal console lines:', allLogs.length);
await browser.close();
