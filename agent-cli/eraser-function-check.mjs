#!/usr/bin/env node
/**
 * eraser-function-check.mjs — functional gate for the gesture-scoped eraser
 * presentation (2026-07-14 E/P text-bob fix). Draws a fresh pen stroke,
 * erases it, and asserts:
 *   1. entering eraser mode does NOT swap presentation (SVG stays),
 *   2. mid-stroke the canvas presentation takes over (live carve),
 *   3. after release the ink is gone and the SVG presentation returns.
 */
import { chromium } from 'playwright';

let PNG;
try { ({ PNG } = await import('pngjs')); } catch { console.error('pngjs missing'); process.exit(2); }

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2] || 'clickable-link-test.pdf';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const inkInRegion = async (region) => {
  const shot = PNG.sync.read(await page.screenshot({ clip: region }));
  let ink = 0;
  for (let i = 0; i < shot.data.length; i += 4) {
    const lum = shot.data[i] * 0.299 + shot.data[i + 1] * 0.587 + shot.data[i + 2] * 0.114;
    if (lum < 120) ink++;
  }
  return ink;
};
const presentation = () => page.evaluate(() => ({
  mode: document.querySelector('[data-annotation-real-surface]')?.dataset.annotationPresentation,
  svgMounted: !!document.querySelector('[data-svg-annotation-layer]'),
  svgWrapperHidden: document.querySelector('[data-diag-svg-wrapper]')?.style.visibility === 'hidden',
}));

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
  await page.waitForTimeout(800);

  const box = await page.locator('[data-annotation-real-surface="1"]').boundingBox();
  const sx = box.x + box.width * 0.72;
  const sy = box.y + box.height * 0.72;

  console.log('[1] draw pen stroke');
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(sx + i * 8, sy + Math.sin(i) * 6); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(700);

  const region = { x: sx - 12, y: sy - 24, width: 110, height: 60 };
  const inkBefore = await inkInRegion(region);
  console.log(`   ink before erase: ${inkBefore}`);
  if (inkBefore < 20) throw new Error('pen stroke did not render');

  console.log('[2] enter eraser — presentation must stay SVG');
  await page.keyboard.press('e');
  await page.waitForTimeout(600);
  const preStroke = await presentation();
  console.log('   pre-stroke:', JSON.stringify(preStroke));
  if (preStroke.mode !== 'svg-edit' || !preStroke.svgMounted) throw new Error('eraser entry swapped presentation (should stay SVG)');

  console.log('[3] erase stroke — canvas must take over mid-gesture');
  await page.mouse.move(sx - 6, sy);
  await page.mouse.down();
  let midStroke = null;
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(sx - 6 + i * 7, sy + Math.sin(i) * 6);
    await page.waitForTimeout(30);
    if (i === 7) midStroke = await presentation();
  }
  console.log('   mid-stroke:', JSON.stringify(midStroke));
  await page.mouse.up();
  await page.waitForTimeout(1200);

  const post = await presentation();
  const inkAfter = await inkInRegion(region);
  console.log('   post-stroke:', JSON.stringify(post));
  console.log(`   ink after erase: ${inkAfter}`);

  const carveTookOver = midStroke?.mode === 'canvas2d' || midStroke?.svgWrapperHidden;
  if (!carveTookOver) throw new Error('live carve never took over during the stroke');
  if (post.mode !== 'svg-edit' || !post.svgMounted || post.svgWrapperHidden) throw new Error('SVG presentation did not return after the stroke');
  if (inkAfter > inkBefore * 0.45) throw new Error(`ink not erased (before=${inkBefore} after=${inkAfter})`);

  console.log('\nPASS — eraser entry keeps SVG, stroke carves on canvas, commit returns to SVG with ink gone');
} catch (e) {
  console.error('FUNCTION CHECK FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
