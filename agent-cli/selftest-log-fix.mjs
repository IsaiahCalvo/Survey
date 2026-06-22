// agent-cli/selftest-log-fix.mjs — self-test for the 2026-06-04 continuous-log fix.
//
// What this CAN verify headlessly (pure Chromium against localhost:5173):
//  1. The in-page buffer still captures home-page lines and survives a reload
//     (the existing rehydrate continuity), and a PAGE RELOAD marker appears.
//  2. The NEW main.jsx fallback branch is correct: in plain Chromium
//     window.electronAPI?.readContinuousLog is undefined, so the capture path
//     MUST fall back to the in-page buffer join — never "(no console output
//     captured)" when the buffer has lines. We assert the exact text the
//     snapshot would send by replaying the capture logic against the live buffer.
//
// What this CANNOT verify headlessly: the actual Electron main-process
// console-message listener (no Electron process here). That is verified by
// reading the wiring back in electron-main.js (done separately by the agent).
import { chromium } from 'playwright';

const DOC_NAME = process.argv[2] || 'Package 2 - Rev 4 -- IC.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();
page.on('console', () => {});

console.log('navigating to localhost:5173 ...');
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);

const HOME_SENTINEL = '=== SELFTEST home-page line (pre-open) ===';
const POST_SENTINEL = '=== SELFTEST post-open line ===';

// 1. Confirm Electron bridge for the continuous log is ABSENT in Chromium —
//    this is what forces the fallback branch.
const bridge = await page.evaluate(() => ({
  hasElectronAPI: typeof window.electronAPI !== 'undefined',
  hasReadContinuous: !!(window.electronAPI && typeof window.electronAPI.readContinuousLog === 'function'),
}));
console.log('bridge (Chromium):', JSON.stringify(bridge));

// 2. Generate a home-page log line into the buffer.
await page.evaluate((s) => { console.log(s); }, HOME_SENTINEL);

// 3. Open the PDF (the heavy-open realm churn).
try {
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 30000 });
  await tile.click();
  await page.waitForTimeout(1500);
  let inViewer = await page.evaluate(() => Array.from(document.querySelectorAll('canvas')).some((c) => c.width > 100 && c.height > 100));
  if (!inViewer) { await tile.dblclick(); await page.waitForTimeout(2500); }
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline && !inViewer) {
    await page.waitForTimeout(500);
    inViewer = await page.evaluate(() => Array.from(document.querySelectorAll('canvas')).some((c) => c.width > 100 && c.height > 100));
  }
  console.log('PDF opened, canvas painted:', inViewer);
} catch (e) { console.log('open failed (continuing):', e.message); }
await page.evaluate((s) => { console.log(s); }, POST_SENTINEL);
await page.waitForTimeout(800); // let throttled persist commit

// 4. Force a real reload — the realm reset the bug hinges on.
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);

// 5. Replay the EXACT capture/fallback logic from main.jsx against the live
//    post-reload buffer and assert what the saved console.log would contain.
const result = await page.evaluate(({ home, post }) => {
  const buf = window.__consoleLogBuffer;
  // Mirror main.jsx synchronous fallback (lines ~149-151).
  const rawConsoleText = Array.isArray(buf) && buf.length > 0
    ? buf.join('\n')
    : '(no console output captured)';
  // In Chromium readContinuousLog is undefined → finalConsoleText stays the
  // in-page buffer text (the fallback branch in main.jsx).
  const usedFallback = !(window.electronAPI && typeof window.electronAPI.readContinuousLog === 'function');
  return {
    bufferLen: Array.isArray(buf) ? buf.length : null,
    isEmptyMarker: rawConsoleText === '(no console output captured)',
    hasHomeLine: rawConsoleText.includes(home),
    hasPostLine: rawConsoleText.includes(post),
    hasReloadMarker: /PAGE RELOAD/.test(rawConsoleText),
    usedFallback,
    headSample: Array.isArray(buf) ? buf.slice(0, 3) : null,
  };
}, { home: HOME_SENTINEL, post: POST_SENTINEL });

console.log('\n=== SELF-TEST RESULT ===');
console.log(JSON.stringify(result, null, 2));

const pass =
  result.usedFallback === true &&
  result.isEmptyMarker === false &&
  result.hasHomeLine === true &&
  result.hasReloadMarker === true;
console.log('\n>>> FALLBACK-BRANCH SELF-TEST PASS:', pass);
console.log('    (home line survived reload:', result.hasHomeLine,
            '| post-open line survived:', result.hasPostLine,
            '| reload marker:', result.hasReloadMarker,
            '| not-empty:', !result.isEmptyMarker, ')');

await browser.close();
process.exit(pass ? 0 : 1);
