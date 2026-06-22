// agent-cli/diag-log-continuity.mjs — empirically (1) determine whether opening a
// PDF resets the in-app console log buffer, and (2) PROVE the sessionStorage
// rehydrate fix keeps the buffer continuous across a real page reload (which is
// what every known reset path — engine toggle, signOut, YDoc banner, ErrorBoundary,
// chunk-load failure — ultimately does).
import { chromium } from 'playwright';

const DOC_NAME = process.argv[2] || 'Package 2 - Rev 4 -- IC.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

const navEvents = [];
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) navEvents.push({ t: Date.now(), url: frame.url() });
});
const allConsole = [];
page.on('console', (m) => allConsole.push(m.text()));

console.log('navigating to localhost:5173 (auto-login as dev account)...');
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);

const SENTINEL = '=== DIAG SENTINEL pre-open line (must survive) ===';

// --- PART A: does opening a PDF cause a reload / buffer reset? ---
const before = await page.evaluate((s) => {
  window.__BUFFER_ID = Math.random().toString(36).slice(2);
  const buf = window.__consoleLogBuffer;
  if (Array.isArray(buf)) buf.push(s);
  return { bufferId: window.__BUFFER_ID, bufferLen: Array.isArray(buf) ? buf.length : null };
}, SENTINEL);
console.log('\n=== A. BEFORE OPEN ===', JSON.stringify(before));

try {
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 30000 });
  await tile.click();
  await page.waitForTimeout(1500);
  let inViewer = await page.evaluate(() => document.querySelectorAll('canvas').length > 0);
  if (!inViewer) { await tile.dblclick(); await page.waitForTimeout(2500); }
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline && !inViewer) {
    await page.waitForTimeout(500);
    inViewer = await page.evaluate(() => Array.from(document.querySelectorAll('canvas')).some((c) => c.width > 100 && c.height > 100));
  }
  await page.waitForTimeout(3000);
  console.log('opened, canvas painted:', inViewer);
} catch (e) { console.log('open failed:', e.message); }

const afterOpen = await page.evaluate((s) => {
  const buf = window.__consoleLogBuffer;
  return {
    bufferId: window.__BUFFER_ID,
    bufferLen: Array.isArray(buf) ? buf.length : null,
    hasSentinel: Array.isArray(buf) ? buf.includes(s) : false,
    canvasCount: document.querySelectorAll('canvas').length,
  };
}, SENTINEL);
console.log('=== A. AFTER OPEN ===', JSON.stringify(afterOpen));
const reloadOnOpen = afterOpen.bufferId !== before.bufferId || !afterOpen.hasSentinel;
console.log('>>> PDF OPEN CAUSED RELOAD/RESET:', reloadOnOpen, '| mainframe navigations during open:', navEvents.length - 1);

// --- PART B: PROVE the fix survives a real reload (the actual reset mechanism) ---
console.log('\n=== B. FIX PROOF: real page reload ===');
const preReload = await page.evaluate(() => ({
  bufferLen: Array.isArray(window.__consoleLogBuffer) ? window.__consoleLogBuffer.length : null,
}));
console.log('buffer length right before reload:', preReload.bufferLen);

await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);

const postReload = await page.evaluate((s) => {
  const buf = window.__consoleLogBuffer;
  return {
    bufferLen: Array.isArray(buf) ? buf.length : null,
    bufferId: window.__BUFFER_ID, // undefined now — reload wiped the injected global, proving a real reload
    hasSentinel: Array.isArray(buf) ? buf.includes(s) : false,
    hasReloadMarker: Array.isArray(buf) ? buf.some((l) => typeof l === 'string' && l.includes('PAGE RELOAD')) : false,
    sampleHead: Array.isArray(buf) ? buf.slice(0, 4) : null,
    sampleTail: Array.isArray(buf) ? buf.slice(-2) : null,
  };
}, SENTINEL);
console.log('AFTER REAL RELOAD:', JSON.stringify(postReload, null, 2));

console.log('\n=== VERDICT (fix) ===');
console.log('real reload confirmed (injected __BUFFER_ID gone):', postReload.bufferId === undefined);
console.log('pre-reload buffer lines:', preReload.bufferLen, '-> post-reload buffer lines:', postReload.bufferLen);
console.log('pre-open sentinel line survived the reload:', postReload.hasSentinel);
console.log('visible PAGE RELOAD marker present:', postReload.hasReloadMarker);
const fixWorks = postReload.bufferId === undefined && postReload.hasSentinel && postReload.hasReloadMarker;
console.log('>>> CONTINUITY FIX WORKS:', fixWorks);

await browser.close();
