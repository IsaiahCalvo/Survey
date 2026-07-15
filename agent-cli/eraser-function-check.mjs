#!/usr/bin/env node
/**
 * eraser-function-check.mjs — functional gate for the gesture-scoped eraser
 * presentation + SVG mask-clone carve base (2026-07-14/15). Draws a target
 * pen stroke and a control pen stroke, erases the target, and asserts:
 *   1. entering eraser mode does NOT swap presentation (SVG stays),
 *   2. mid-stroke the carve preview takes over AND the carve is VISIBLE
 *      (target ink strictly decreases before pointer-up),
 *   3. the CONTROL stroke's pixels are unchanged mid-stroke (mask-clone
 *      fidelity — same engine, same box; measured ~0.04-0.25% vs ~17% for
 *      any bitmap copy),
 *   4. after release the target ink is gone, control intact, SVG returns.
 * ZOOM_CLICKS=N zooms in first (exercises the deep-zoom regime).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

let PNG;
try { ({ PNG } = await import('pngjs')); } catch { console.error('pngjs missing'); process.exit(2); }

const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts', 'eraser-function-check');
fs.rmSync(ART_DIR, { recursive: true, force: true });
fs.mkdirSync(ART_DIR, { recursive: true });

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2] || 'clickable-link-test.pdf';
const ZOOM_CLICKS = Number(process.env.ZOOM_CLICKS || 0);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (t.includes("EraserCarveDiag")) console.log('  APP:', t);
});

const inkInRegion = async (region) => {
  const shot = PNG.sync.read(await page.screenshot({ clip: region }));
  let ink = 0;
  for (let i = 0; i < shot.data.length; i += 4) {
    const lum = shot.data[i] * 0.299 + shot.data[i + 1] * 0.587 + shot.data[i + 2] * 0.114;
    if (lum < 120) ink++;
  }
  return ink;
};
const shotOf = async (region) => PNG.sync.read(await page.screenshot({ clip: region }));
// Pixels whose any-channel delta exceeds 8 (absorbs premultiply rounding).
const diffPixels = (a, b) => {
  if (a.width !== b.width || a.height !== b.height) return Number.MAX_SAFE_INTEGER;
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
const presentation = () => page.evaluate(() => ({
  mode: document.querySelector('[data-annotation-real-surface]')?.dataset.annotationPresentation,
  svgMounted: !!document.querySelector('[data-svg-annotation-layer]'),
  svgWrapperHidden: document.querySelector('[data-diag-svg-wrapper]')?.style.visibility === 'hidden',
  maskClones: document.querySelectorAll('[data-eraser-mask-clone]').length,
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

  if (ZOOM_CLICKS > 0) {
    console.log(`[0] zoom in ×${ZOOM_CLICKS}`);
    const zoomIn = page.locator('#chrome-right-host button[aria-label="Zoom in"]').first();
    for (let i = 0; i < ZOOM_CLICKS; i++) { await zoomIn.click(); await page.waitForTimeout(300); }
    await page.waitForTimeout(900);
  }

  const box = await page.locator('[data-annotation-real-surface="1"]').boundingBox();
  const vw = page.viewportSize();
  // Anchor both strokes to the VISIBLE viewport so deep zoom still works.
  const vx = (f) => Math.max(box.x, 0) + (Math.min(box.x + box.width, vw.width) - Math.max(box.x, 0)) * f;
  const vy = (f) => Math.max(box.y, 0) + (Math.min(box.y + box.height, vw.height) - Math.max(box.y, 0)) * f;
  // Target mid-right, control upper-left — both clear of the bottom-center
  // undo toast that pops after an erase commit.
  const sx = vx(0.62);
  const sy = vy(0.55);
  const cx = vx(0.30);
  const cy = vy(0.30);

  console.log('[1] draw target + control pen strokes');
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(sx + i * 8, sy + Math.sin(i) * 6); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(cx + i * 8, cy + Math.cos(i) * 6); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(700);

  const region = { x: sx - 12, y: sy - 24, width: 110, height: 60 };
  const controlRegion = { x: cx - 12, y: cy - 24, width: 110, height: 60 };
  const inkBefore = await inkInRegion(region);
  console.log(`   target ink before erase: ${inkBefore}`);
  if (inkBefore < 20) throw new Error('pen stroke did not render');

  console.log('[2] enter eraser — presentation must stay SVG');
  // Park the mouse far from both regions FIRST: the eraser cursor ring
  // renders at the pointer and would contaminate the control screenshots.
  await page.mouse.move(vx(0.95), vy(0.95));
  await page.waitForTimeout(150);
  await page.keyboard.press('e');
  await page.waitForTimeout(600);
  const preStroke = await presentation();
  console.log('   pre-stroke:', JSON.stringify(preStroke));
  if (preStroke.mode !== 'svg-edit' || !preStroke.svgMounted) throw new Error('eraser entry swapped presentation (should stay SVG)');
  const controlBefore = await shotOf(controlRegion);

  console.log('[3] erase target — carve must be visible + control must not move');
  await page.mouse.move(sx - 6, sy);
  await page.mouse.down();
  let midStroke = null;
  let midInk = null;
  let controlMidDiff = null;
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(sx - 6 + i * 7, sy + Math.sin(i) * 6);
    await page.waitForTimeout(30);
    if (i === 10) {
      midStroke = await presentation();
      midInk = await inkInRegion(region);
      const controlMid = await shotOf(controlRegion);
      controlMidDiff = diffPixels(controlBefore, controlMid);
      fs.writeFileSync(path.join(ART_DIR, 'control-before.png'), PNG.sync.write(controlBefore));
      fs.writeFileSync(path.join(ART_DIR, 'control-mid.png'), PNG.sync.write(controlMid));
    }
  }
  console.log('   mid-stroke:', JSON.stringify(midStroke));
  console.log(`   mid-stroke target ink: ${midInk} (before: ${inkBefore})`);
  console.log(`   mid-stroke control diff px: ${controlMidDiff} of ${controlBefore.width * controlBefore.height}`);
  await page.mouse.up();
  await page.waitForTimeout(1400);

  const post = await presentation();
  const inkAfter = await inkInRegion(region);
  const controlAfterDiff = diffPixels(controlBefore, await shotOf(controlRegion));
  console.log('   post-stroke:', JSON.stringify(post));
  console.log(`   target ink after erase: ${inkAfter}; control diff px after: ${controlAfterDiff}`);

  const carveTookOver = midStroke?.mode === 'canvas2d' || midStroke?.svgWrapperHidden;
  if (!carveTookOver) throw new Error('live carve never took over during the stroke');
  if (midInk == null || midInk > inkBefore * 0.75) throw new Error(`LIVE CARVE NOT VISIBLE mid-stroke (before=${inkBefore} mid=${midInk})`);
  const controlArea = controlBefore.width * controlBefore.height;
  if (controlMidDiff > controlArea * 0.003) throw new Error(`PHOTO FIDELITY FAILED — untouched annotation changed mid-stroke (${controlMidDiff} px)`);
  if (post.mode !== 'svg-edit' || !post.svgMounted || post.svgWrapperHidden) throw new Error('SVG presentation did not return after the stroke');
  if (inkAfter > inkBefore * 0.45) throw new Error(`ink not erased (before=${inkBefore} after=${inkAfter})`);
  if (controlAfterDiff > controlArea * 0.003) throw new Error(`control annotation changed after commit (${controlAfterDiff} px)`);

  console.log('\nPASS — SVG stays until stroke, carve visible mid-stroke, untouched ink pixel-identical, commit clean');
} catch (e) {
  console.error('FUNCTION CHECK FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
