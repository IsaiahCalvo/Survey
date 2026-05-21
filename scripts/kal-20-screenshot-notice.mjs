// KAL-20 screenshot runner — launches a clean Playwright Chromium
// (NOT the shared MCP browser) against the kal-20-notice-test.html harness
// and captures evidence screenshots:
//   1. notice-appearing.png — notice visible with FileAttachment named
//   2. notice-dismissed.png — after clicking the X
//   3. negative-case.png — after re-running on the supported-only fixture

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.KAL20_PORT) || 5202;
const URL = `http://localhost:${PORT}/kal-20-notice-test.html`;
const OUT_DIR = path.resolve('debug/screenshots/kal-20');

async function ensurePdfWorker() {
  const dest = path.resolve('public/kal-20-pdf.worker.js');
  try {
    await fs.access(dest);
    return;
  } catch {
    /* needs copy */
  }
  // Walk upward looking for `node_modules/pdfjs-dist/legacy/build/pdf.worker.js`
  let dir = process.cwd();
  while (dir && dir !== '/') {
    const candidate = path.join(dir, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.js');
    try {
      await fs.access(candidate);
      const bytes = await fs.readFile(candidate);
      await fs.writeFile(dest, bytes);
      console.log(`[setup] copied pdf.worker.js from ${candidate} -> ${dest}`);
      return;
    } catch {
      dir = path.dirname(dir);
    }
  }
  throw new Error('Could not find node_modules/pdfjs-dist/legacy/build/pdf.worker.js');
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await ensurePdfWorker();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', (msg) => console.log(`[browser ${msg.type()}]`, msg.text()));

  console.log('Navigating to', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // Wait for the importer to populate window.__kal20Result.
  await page.waitForFunction(() => !!window.__kal20Result, { timeout: 20000 });
  const positive = await page.evaluate(() => window.__kal20Result);
  console.log('[positive] unsupportedTypes =', positive?.unsupportedTypes);
  console.log('[positive] importedTypesByPage =', JSON.stringify(positive?.importedTypesByPage));

  // Give the notice's enter-transition time to settle.
  await page.waitForTimeout(500);

  // Screenshot 1: notice appearing
  const shot1 = path.join(OUT_DIR, 'notice-appearing.png');
  await page.screenshot({ path: shot1, fullPage: false });
  console.log('Saved', shot1);

  // Confirm the notice DOM contains "FileAttachment".
  const noticeText = await page.evaluate(() => {
    const root = document.getElementById('notice-root');
    return root ? root.innerText : null;
  });
  console.log('[positive notice innerText]', noticeText);
  if (!noticeText || !noticeText.includes('FileAttachment')) {
    throw new Error(`Notice did not include FileAttachment. innerText=${noticeText}`);
  }

  // Click the dismiss button inside the notice (the SVG X icon's button).
  await page.evaluate(() => {
    const btn = document.querySelector('#notice-root button[title="Dismiss"]');
    if (btn) btn.click();
  });
  // Wait for the 300ms exit transition + state.
  await page.waitForTimeout(800);

  // Screenshot 2: notice dismissed
  const shot2 = path.join(OUT_DIR, 'notice-dismissed.png');
  await page.screenshot({ path: shot2, fullPage: false });
  const dismissedNoticeText = await page.evaluate(() => {
    const root = document.getElementById('notice-root');
    return root ? root.innerText : null;
  });
  console.log('[dismissed notice innerText]', dismissedNoticeText);
  console.log('Saved', shot2);

  // Re-run on the supported-only fixture by clicking the harness button.
  await page.evaluate(() => document.getElementById('rerun-negative').click());
  await page.waitForFunction(() => !!window.__kal20NegSummary, { timeout: 20000 });
  const negative = await page.evaluate(() => window.__kal20NegSummary);
  console.log('[negative] unsupportedTypes =', negative?.unsupportedTypes);
  console.log('[negative] importedTypesByPage =', JSON.stringify(negative?.importedTypesByPage));

  await page.waitForTimeout(300);
  const shot3 = path.join(OUT_DIR, 'negative-case.png');
  await page.screenshot({ path: shot3, fullPage: false });
  console.log('Saved', shot3);

  await browser.close();

  // Final pass/fail summary.
  const ok =
    Array.isArray(positive?.unsupportedTypes) &&
    positive.unsupportedTypes.includes('FileAttachment') &&
    Array.isArray(negative?.unsupportedTypes) &&
    negative.unsupportedTypes.length === 0;
  console.log('\n=== KAL-20 RESULT ===');
  console.log('Positive case (mixed fixture):', positive?.unsupportedTypes);
  console.log('Negative case (supported only):', negative?.unsupportedTypes);
  console.log(ok ? 'VERDICT: PASS' : 'VERDICT: FAIL');
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
