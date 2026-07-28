// agent-cli/render-smoke.mjs — headless proof that the viewer actually RENDERS.
//
// Drives the real app in Chromium (dev auto-login), opens a document, and asserts
// the pdf.js canvas paints real (non-blank) pixels with no console/page errors.
// This is the GUI-render counterpart to index.mjs (which only proves the backend
// read path). Use it after any change to PDFViewer's render tree.
//
//   APP_URL=http://localhost:5180 node agent-cli/render-smoke.mjs ["Doc name.pdf"]
//   HEADFUL=1 APP_URL=... node agent-cli/render-smoke.mjs        # watch it run
//
// Exit 0 = rendered a non-blank canvas, no errors. Exit 1 = failed (reason printed).
// ponytail: hardcoded selectors/timeouts; lift to args if a second caller needs them.
import { chromium } from 'playwright';
import { assertBrowserUsesLeasedAccount, installLeasedBrowserAccount } from './lib/leased-browser-session.mjs';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2] || 'Package 2 - Rev 4 -- IC.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;
const OUT = new URL('./render-smoke-result.png', import.meta.url).pathname;

const fail = (msg) => { console.error(`\n❌ FAIL: ${msg}`); process.exitCode = 1; };

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));

try {
  console.log(`→ navigating to ${APP_URL} (dev auto-login)...`);
  const leasedBrowserAccount = await installLeasedBrowserAccount(page);
  await page.goto(APP_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await assertBrowserUsesLeasedAccount(page, { account: leasedBrowserAccount });

  // Wait for auto-login + dashboard tiles, select the doc, then click "Open file".
  console.log(`→ waiting for document tile: "${DOC_NAME}"`);
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 45000 });
  await tile.click();            // selects the row → opens the preview panel
  console.log('→ clicking "Open file"...');
  const openBtn = page.getByRole('button', { name: /open file/i }).first();
  await openBtn.waitFor({ state: 'visible', timeout: 15000 });
  await openBtn.click();

  // Wait for the live pdf.js viewer + a painted page canvas.
  console.log('→ waiting for pdf.js canvas to paint...');
  await page.waitForSelector('.survey-pdfjs-viewer', { timeout: 30000 });
  await page.waitForFunction(() => {
    const c = [...document.querySelectorAll('.survey-pdfjs-viewer canvas, .pdf-engine-host canvas')]
      .find(el => el.clientWidth > 80 && el.clientHeight > 80);
    return !!c;
  }, { timeout: 45000 });

  // Assert SOME canvas paints real content. The viewer stacks transparent overlay
  // canvases (Fabric annotation/eraser layers) over the pdf.js page canvas — so we
  // scan every sized canvas and keep the one with the widest luminance range (the
  // rendered page), instead of guessing by size.
  const probe = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('.survey-pdfjs-viewer canvas, .pdf-engine-host canvas')]
      .filter(el => el.clientWidth > 80 && el.clientHeight > 80);
    if (!canvases.length) return { ok: false, reason: 'no sized canvas' };
    let best = null;
    for (const c of canvases) {
      try {
        const g = c.getContext('2d');
        const { width: w, height: h } = c;
        if (!w || !h) continue;
        const data = g.getImageData(0, 0, w, h).data;
        let min = 255, max = 0, opaque = 0, sampled = 0;
        for (let i = 0; i < data.length; i += 4 * 997) {
          if (data[i + 3] < 16) { sampled++; continue; } // transparent → skip luminance
          const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
          min = Math.min(min, lum); max = Math.max(max, lum);
          opaque++; sampled++;
        }
        const range = opaque ? max - min : 0;
        if (!best || range > best.range) best = { w, h, range, lumMin: Math.round(min), lumMax: Math.round(max), opaquePct: Math.round((opaque / sampled) * 100) };
      } catch (e) { /* tainted/secured canvas — skip */ }
    }
    if (!best) return { ok: false, reason: 'no readable canvas' };
    return { ok: true, canvasCount: canvases.length, ...best };
  });

  await page.screenshot({ path: OUT, fullPage: false });
  console.log(`→ screenshot: ${OUT}`);
  console.log('→ canvas probe:', JSON.stringify(probe));

  if (!probe.ok) fail(`canvas probe failed: ${probe.reason}`);
  else if (probe.range < 10) fail(`best canvas looks blank (luminance range ${probe.range}, ${probe.lumMin}-${probe.lumMax})`);
  else console.log(`\n✅ RENDERED: ${probe.canvasCount} canvas(es); page canvas ${probe.w}x${probe.h}, luminance range ${probe.range} (${probe.lumMin}-${probe.lumMax}), ${probe.opaquePct}% opaque`);

  if (pageErrors.length) fail(`${pageErrors.length} uncaught page error(s): ${pageErrors.slice(0, 3).join(' | ')}`);
  const realConsoleErrors = consoleErrors.filter(e => !/favicon|Download the React DevTools|Failed to load resource/.test(e));
  if (realConsoleErrors.length) console.log(`⚠ ${realConsoleErrors.length} console error(s) (first 3): ${realConsoleErrors.slice(0, 3).join(' | ')}`);
} catch (e) {
  await page.screenshot({ path: OUT, fullPage: false }).catch(() => {});
  fail(`${e.message}  (screenshot: ${OUT})`);
} finally {
  await browser.close();
}
