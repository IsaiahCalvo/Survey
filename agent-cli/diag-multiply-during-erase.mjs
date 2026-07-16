#!/usr/bin/env node
/**
 * diag-multiply-during-erase.mjs — does a highlighter (multiply-blend) mark
 * keep its see-through look while an erase stroke is active elsewhere?
 * The mask-clone wraps everything in a masked group, which isolates
 * mix-blend-mode from the PDF page backdrop (adversarial review finding) —
 * this measures whether that isolation is visible in practice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

let PNG;
try { ({ PNG } = await import('pngjs')); } catch { console.error('pngjs missing'); process.exit(2); }

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2] || 'clickable-link-test.pdf';
const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts', 'diag-multiply');
fs.rmSync(ART_DIR, { recursive: true, force: true });
fs.mkdirSync(ART_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const diffPixels = (a, b) => {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) > 8
      || Math.abs(a.data[i + 1] - b.data[i + 1]) > 8
      || Math.abs(a.data[i + 2] - b.data[i + 2]) > 8
    ) n++;
  }
  return n;
};

try {
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 45000 });
  await tile.click();
  const openBtn = page.getByRole('button', { name: /open file/i }).first();
  await openBtn.waitFor({ state: 'visible', timeout: 15000 });
  await openBtn.click();
  await page.waitForSelector('.survey-pdfjs-viewer', { timeout: 30000 });
  await page.keyboard.press('v');
  await page.waitForSelector('[data-svg-annotation-layer="1"]', { timeout: 20000 });
  await page.waitForTimeout(900);

  const box = await page.locator('[data-annotation-real-surface="1"]').boundingBox();
  // Highlight across the page text near the top ("…in the box:" label).
  const hx = box.x + box.width * 0.18;
  const hy = box.y + box.height * 0.20;

  console.log('[1] draw highlighter over page text');
  await page.keyboard.press('h');
  await page.waitForTimeout(300);
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(hx + i * 10, hy); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.keyboard.press('v');
  await page.mouse.move(2, 2);
  await page.waitForTimeout(500);

  const region = { x: hx - 10, y: hy - 22, width: 150, height: 44 };
  const live = PNG.sync.read(await page.screenshot({ clip: region }));
  fs.writeFileSync(path.join(ART_DIR, 'highlight-live.png'), PNG.sync.write(live));

  console.log('[2] erase stroke far away — measure the highlight mid-gesture');
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9);
  await page.keyboard.press('e');
  await page.waitForTimeout(500);
  const ex = box.x + box.width * 0.62;
  const ey = box.y + box.height * 0.72;
  await page.mouse.move(ex, ey);
  await page.mouse.down();
  let midShot = null;
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(ex + i * 6, ey + Math.sin(i) * 5);
    await page.waitForTimeout(25);
    if (i === 9) midShot = PNG.sync.read(await page.screenshot({ clip: region }));
  }
  await page.mouse.up();
  await page.waitForTimeout(1200);
  fs.writeFileSync(path.join(ART_DIR, 'highlight-mid-erase.png'), PNG.sync.write(midShot));
  const after = PNG.sync.read(await page.screenshot({ clip: region }));

  const midDiff = diffPixels(live, midShot);
  const afterDiff = diffPixels(live, after);
  const total = live.width * live.height;
  console.log(`\nhighlight region: mid-gesture diff ${midDiff}/${total} px (${(100 * midDiff / total).toFixed(2)}%); after-commit diff ${afterDiff}/${total}`);
  console.log(`artifacts: ${ART_DIR}`);
  process.exitCode = midDiff > total * 0.02 ? 1 : 0;
} catch (e) {
  console.error('DIAG ERROR:', e.message);
  process.exitCode = 2;
} finally {
  await browser.close();
}
