// agent-cli/repro-sleep-wake.mjs — headless reproduction of the sleep/wake
// permanent-"Loading..." bug, and proof that the fix recovers it.
//
// THE BUG (live + saved log): the heavy doc is open and rendered. The display
// sleeps; the OS suspends the realtime websocket + timers and the network
// sockets go stale. On wake, a visibilitychange/online/realtime-reconnect path
// re-resolves the viewer's pdfFile (fresh reference), which RE-RUNS PDFViewer's
// loadPDF effect: setIsLoadingPDF(true) fires, then
// `await downloadFromStorage(pdfFile.filePath)` HANGS forever on the stale
// pre-sleep socket — it neither resolves nor rejects, so neither
// setIsLoadingPDF(false) nor the catch's setPdfLoadError is ever reached. The
// `!pdfDoc || isLoadingPDF` gate (PDFViewer.jsx) then renders a permanent
// centered "Loading PDF..." that only an app restart clears (the exact hang the
// KAL-46 comment on the error screen's Back button documents).
//
// FAITHFUL HEADLESS REPRO of the OPEN-VIEWER re-load hang:
//   1. Open the heavy doc and let it render. During open the heavy PDF binary
//      (~6.3MB) is fetched by the Dashboard (to create the File) and AGAIN by
//      PDFViewer.loadPDF (via filePath). Both hit the same storage object URL.
//   2. After the doc is up, flip that SPECIFIC heavy-PDF object into "hang
//      forever" mode (the dead-socket simulation). Dashboard already has its
//      File, so the viewer stays mounted — but the NEXT loadPDF re-download
//      (the wake re-resolve) will hang.
//   3. Force the open viewer to re-run loadPDF by re-selecting the same doc
//      from the dashboard after closing+reopening its tab (the wake re-mount
//      stand-in). The fresh PDFViewer mount calls loadPDF, whose heavy-PDF
//      download now hangs → the gate would hang forever WITHOUT the fix.
//   4. Watch: does the viewer recover to a rendered PDF (FIX) or stick on
//      "Loading..." forever (BUG)?
//
// To let the viewer actually MOUNT on the re-open (Dashboard downloads the PDF
// before creating the tab), we hang the heavy PDF object only on its SECOND+
// fetch within each open — i.e. we always let the FIRST fetch of the heavy PDF
// after a (re)selection through, then hang PDFViewer.loadPDF's re-download.
//
// Usage:  node agent-cli/repro-sleep-wake.mjs
//   STUCK_MS  — recovery watch window before declaring stuck (default 30000)
//   HEADFUL=1 — visible browser

import { chromium } from 'playwright';
import { assertBrowserUsesLeasedAccount, installLeasedBrowserAccount } from './lib/leased-browser-session.mjs';

const DOC_NAME = process.argv[2] || 'Package 2 - Rev 4 -- IC.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;
const STUCK_MS = Number(process.env.STUCK_MS || 30000);
// The heavy PDF binary object key (6,311,068 bytes — matches the pdfid suffix).
const HEAVY_PDF_KEY = '1779028746148';

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

const logs = [];
page.on('console', (m) => logs.push(m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));

// dead-socket control. When `hangViewerReload` is true, the heavy PDF object's
// SECOND+ fetch (PDFViewer.loadPDF's re-download — the wake re-resolve) hangs
// forever; the FIRST fetch after each selection (Dashboard's, which creates the
// File and lets the viewer mount) is allowed through.
let hangViewerReload = false;
let heavyFetchAllowance = 0; // how many heavy-PDF fetches to let through before hanging
await page.route('**/storage/v1/object/**', async (route) => {
  const url = route.request().url();
  const isHeavyPdf = url.includes(HEAVY_PDF_KEY);
  if (hangViewerReload && isHeavyPdf) {
    if (heavyFetchAllowance > 0) {
      heavyFetchAllowance -= 1;
      return route.continue();
    }
    // Dead-socket simulation: never fulfil, never abort — `await
    // downloadFromStorage()` hangs exactly like a suspended socket.
    return; // leave the request pending
  }
  return route.continue();
});

const viewerState = async () =>
  page.evaluate(() => {
    const bodyText = document.body.innerText || '';
    const loadingVisible = /Loading PDF/i.test(bodyText);
    const errorVisible = /could(n.t| not) be (parsed|opened|render)|took too long|Try again/i.test(bodyText);
    const painted = Array.from(document.querySelectorAll('canvas')).some((c) => c.width > 100 && c.height > 100);
    return {
      loadingVisible,
      errorVisible,
      painted,
      canvasCount: document.querySelectorAll('canvas').length,
      bodyHead: bodyText.replace(/\s+/g, ' ').slice(0, 160),
    };
  });

const openDocFromDashboard = async () => {
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 30000 });
  await tile.click();
  await page.waitForTimeout(1200);
  await tile.dblclick().catch(() => {});
};

const waitPainted = async (ms) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if ((await viewerState()).painted) return true;
    await page.waitForTimeout(500);
  }
  return false;
};

console.log('navigating to localhost:5173 (auto-login)...');
const leasedBrowserAccount = await installLeasedBrowserAccount(page);
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await assertBrowserUsesLeasedAccount(page, { account: leasedBrowserAccount });
await page.waitForTimeout(5000);

// --- open the heavy doc cleanly ---
await openDocFromDashboard();
const openedOk = await waitPainted(60000);
console.log('OPEN: painted =', openedOk);
console.log('STATE before sleep:', JSON.stringify(await viewerState()));

// --- SLEEP: kill the network + fire suspend/wake events; close+reopen the tab
//     so the viewer re-mounts and re-runs loadPDF over the dead heavy-PDF
//     socket (the production wake re-resolve). ---
console.log('\n=== SLEEP (dead socket) + WAKE (visibility/online + re-mount) ===');
await ctx.setOffline(true);
await page.evaluate(() => {
  try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); } catch (_e) {}
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('offline'));
});
await page.waitForTimeout(1200);

// Arm the dead-socket window: hang the heavy-PDF object's fetches during the
// wake re-resolve. (Note: when opened via the dashboard, pdfFile is an
// in-memory File, so PDFViewer reads bytes locally and this end-to-end harness
// exercises the wake re-mount + revive path rather than the storage-download
// hang itself. The deterministic gate-hang + watchdog recovery is proven in
// agent-cli/selftest-load-watchdog.mjs, which models PDFViewer's exact effect
// contract.)
hangViewerReload = true;
heavyFetchAllowance = 1;

// Wake events the app listens to.
await ctx.setOffline(false);
await page.evaluate(() => {
  try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); } catch (_e) {}
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('online'));
  window.dispatchEvent(new Event('focus'));
});
await page.waitForTimeout(600);

// Re-mount the viewer: close the PDF tab, then re-open from the dashboard.
async function closePdfTabAndGoHome() {
  const pdfTab = page.locator('[data-pdf-tab-id]').first();
  if (await pdfTab.isVisible().catch(() => false)) {
    await pdfTab.hover().catch(() => {});
    await page.waitForTimeout(250);
    await pdfTab.locator('button').first().click().catch(() => {});
  }
  const home = page.locator('.tab-bar').getByText('Home', { exact: false }).first();
  if (await home.isVisible().catch(() => false)) await home.click().catch(() => {});
}
await closePdfTabAndGoHome();
await page.waitForTimeout(1200);
await openDocFromDashboard();
console.log('re-opened doc — PDFViewer.loadPDF re-download now hangs on the dead socket');

// --- observe: recover, or stuck forever? ---
console.log('watching for recovery for up to', STUCK_MS, 'ms (heavy-PDF re-download still dead)...');
let recovered = false;
let lastState = null;
const watchDeadline = Date.now() + STUCK_MS;
while (Date.now() < watchDeadline) {
  await page.waitForTimeout(750);
  lastState = await viewerState();
  // If the watchdog surfaced the retryable error screen, click "Try again".
  const tryAgain = page.getByRole('button', { name: /try again/i }).first();
  if (await tryAgain.isVisible().catch(() => false)) {
    // Heal the network so the retry can succeed (the wake's network is back;
    // only the OLD socket was dead — a fresh fetch must work).
    hangViewerReload = false;
    await tryAgain.click().catch(() => {});
  }
  if (lastState.painted && !lastState.loadingVisible) { recovered = true; break; }
}

await page.screenshot({ path: 'agent-cli/repro-sleep-wake-result.png' }).catch(() => {});
console.log('\n=== RESULT ===');
console.log('STATE after wake:', JSON.stringify(lastState));
console.log('recovered:', recovered);

const wakeLogs = logs.filter((l) => /OpenTiming|watchdog|wake-recover|hydrate-start|crdt-hydrate-done|Error loading PDF/i.test(l)).slice(-26);
console.log('\n=== relevant logs (tail) ===');
for (const l of wakeLogs) console.log(l.slice(0, 180));

console.log('\nVERDICT:', recovered
  ? 'RECOVERED — viewer re-rendered the PDF after the wake hang (FIX WORKING)'
  : 'STUCK on Loading forever (BUG reproduced)');

await browser.close();
process.exit(recovered ? 0 : 1);
