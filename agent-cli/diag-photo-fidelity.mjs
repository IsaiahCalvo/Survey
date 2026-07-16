#!/usr/bin/env node
/**
 * diag-photo-fidelity.mjs — bisects the photograph pipeline: builds the same
 * SVG-region photo the eraser uses, composites it over white IN THE PAGE,
 * and saves it next to a live screenshot of the same region. If the photo
 * alone is faithful, the fade lives in the preview pipeline; if the photo is
 * pale, the SVG-as-image rasterization differs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2] || 'clickable-link-test.pdf';
const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts', 'diag-photo-fidelity');
fs.rmSync(ART_DIR, { recursive: true, force: true });
fs.mkdirSync(ART_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

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
  await page.waitForTimeout(1200);
  await page.mouse.move(2, 2);

  const box = await page.locator('[data-annotation-real-surface="1"]').boundingBox();
  // Same control spot as the function check.
  const region = { x: box.x + box.width * 0.30 - 12, y: box.y + box.height * 0.30 - 24, width: 110, height: 60 };
  fs.writeFileSync(path.join(ART_DIR, 'live.png'), await page.screenshot({ clip: region }));

  if (process.env.PHASE) await page.evaluate((v) => { window.__PHASE = Number(v); }, process.env.PHASE);
  if (process.env.PAINTER) await page.evaluate(() => { window.__PAINTER = true; });
  const result = await page.evaluate(async (reg) => {
    const surface = document.querySelector('[data-annotation-real-surface="1"]');
    const svg = surface?.querySelector('svg[data-svg-annotation-layer]');
    const detail = surface?.querySelector('canvas[data-annotation-detail-active="true"]');
    const source = detail || surface?.querySelector('canvas[data-annotation-presentation-canvas]');
    if (!surface || !svg || !source) return { error: 'layers missing' };
    const pageWidth = 612, pageHeight = 792;
    const drawScale = Number(source.dataset.canvasDrawScale) || (source.width / pageWidth);
    const drawScaleY = Number(source.dataset.canvasDrawScaleY) || drawScale;
    const offsetX = Number(source.dataset.canvasPageOffsetX) || 0;
    const offsetY = Number(source.dataset.canvasPageOffsetY) || 0;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const outer = document.createElementNS(SVG_NS, 'svg');
    outer.setAttribute('xmlns', SVG_NS);
    outer.setAttribute('width', String(source.width));
    outer.setAttribute('height', String(source.height));
    // PHASE experiment: bake the source layer's fractional device offset
    // into the raster grid so the photo's AA phase matches the live SVG's.
    let vbX = offsetX, vbY = offsetY;
    if (window.__PHASE) {
      const srcRect = source.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      let fx = ((srcRect.x * dpr) % 1 + 1) % 1;
      let fy = ((srcRect.y * dpr) % 1 + 1) % 1;
      if (window.__PHASE === 2) { if (fx > 0.5) fx -= 1; if (fy > 0.5) fy -= 1; }
      if (window.__PHASE === 3) { fx = -fx; fy = -fy; }
      vbX = offsetX - fx / drawScale;
      vbY = offsetY - fy / drawScaleY;
      window.__PHASE_APPLIED = { fx, fy };
    }
    if (window.__PAINTER) {
      // Baseline mode: measure the OLD hand-painted copy with the same probe.
      window.__PAINTER_SOURCE = source;
    }
    outer.setAttribute('viewBox', `${vbX} ${vbY} ${source.width / drawScale} ${source.height / drawScaleY}`);
    outer.setAttribute('preserveAspectRatio', 'none');
    const clone = svg.cloneNode(true);
    clone.setAttribute('x', '0');
    clone.setAttribute('y', '0');
    clone.setAttribute('width', String(pageWidth));
    clone.setAttribute('height', String(pageHeight));
    clone.setAttribute('preserveAspectRatio', 'none');
    clone.style.width = '';
    clone.style.height = '';
    outer.appendChild(clone);
    const markup = new XMLSerializer().serializeToString(outer);
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    await new Promise((res, rej) => { image.onload = res; image.onerror = () => rej(new Error('decode failed')); image.src = url; });
    // Mount the photo EXACTLY like the eraser preview does (same box as the
    // source canvas, inside the page host), hide the SVG, and let the caller
    // screenshot — identical compositing over the identical page backdrop.
    const out = document.createElement('canvas');
    out.width = source.width;
    out.height = source.height;
    out.getContext('2d').drawImage(window.__PAINTER ? source : image, 0, 0);
    out.style.position = 'absolute';
    out.style.left = source.style.left || '0px';
    out.style.top = source.style.top || '0px';
    if (window.__PHASE === 4 && window.__PHASE_APPLIED) {
      // Snap the canvas layer to the device grid (kills compositor
      // resampling) and the raster bake above restores true screen phase.
      const dpr = window.devicePixelRatio || 1;
      const { fx, fy } = window.__PHASE_APPLIED;
      const baseLeft = parseFloat(source.style.left) || 0;
      const baseTop = parseFloat(source.style.top) || 0;
      out.style.left = `${baseLeft - fx / dpr}px`;
      out.style.top = `${baseTop - fy / dpr}px`;
    }
    out.style.width = source.style.width || '100%';
    out.style.height = source.style.height || '100%';
    out.style.zIndex = '5000';
    out.style.pointerEvents = 'none';
    out.dataset.photoFidelityProbe = '1';
    surface.appendChild(out);
    const wrapper = surface.querySelector('[data-diag-svg-wrapper]');
    if (wrapper) wrapper.style.visibility = 'hidden';
    URL.revokeObjectURL(url);
    return {
      imageSize: { w: image.width, h: image.height },
      sourceSize: { w: source.width, h: source.height },
      sourceStyle: { left: source.style.left, top: source.style.top, w: source.style.width, h: source.style.height },
    };
  }, region);

  if (result.error) throw new Error(result.error);
  console.log('image intrinsic:', JSON.stringify(result.imageSize), 'source backing:', JSON.stringify(result.sourceSize), 'css:', JSON.stringify(result.sourceStyle));
  await page.waitForTimeout(300);
  fs.writeFileSync(path.join(ART_DIR, 'photo-in-dom.png'), await page.screenshot({ clip: region }));
  await page.evaluate(() => {
    document.querySelector('[data-photo-fidelity-probe]')?.remove();
    const wrapper = document.querySelector('[data-diag-svg-wrapper]');
    if (wrapper) wrapper.style.visibility = '';
  });
  console.log('saved:', ART_DIR);
} catch (e) {
  console.error('DIAG ERROR:', e.message);
  process.exitCode = 2;
} finally {
  await browser.close();
}
