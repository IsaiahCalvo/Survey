#!/usr/bin/env node
/**
 * diag-zoom-bob.mjs — settled-state A/B diagnostic at an exact zoom percent.
 *
 * The zoom-sweep transition probe caught the user's E/P text bob at 447%
 * (typed zoom): eraser mode paints the callout text ~5.9 device px lower.
 * This script parks at one percent, screenshots the callout region in pen
 * mode vs eraser mode, cross-correlates rows to measure the vertical shift,
 * and dumps the app's own [EraserParityDiag] numbers for both transitions.
 *
 *   ZOOM_PCT=447 node agent-cli/diag-zoom-bob.mjs 'clickable-link-test.pdf'
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

let PNG;
try { ({ PNG } = await import('pngjs')); } catch { console.error('pngjs missing'); process.exit(2); }

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const DOC_NAME = process.argv[2] || 'clickable-link-test.pdf';
const TARGET_TEXT = process.env.TARGET_TEXT || 'tes';
const ZOOM_PCT = Number(process.env.ZOOM_PCT || 447);

const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts', 'diag-zoom-bob');
fs.rmSync(ART_DIR, { recursive: true, force: true });
fs.mkdirSync(ART_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1091, height: 690 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (msg) => {
  const t = msg.text();
  if (t.includes('EraserParityDiag')) console.log('  APP:', t.slice(0, 900));
});

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

  // LADDER=1 first climbs the zoom-in button ladder to ≥4300 CSS px host
  // width (the sweep probe's prehistory — the anomaly needs it; a typed-only
  // path does not reproduce).
  if (process.env.LADDER) {
    const zoomIn = page.locator('#chrome-right-host button[aria-label="Zoom in"]').first();
    for (let i = 0; i < 20; i++) {
      const w = await page.evaluate(() => document.querySelector('[data-annotation-real-surface="1"]')?.parentElement?.getBoundingClientRect()?.width || 0);
      if (w >= 4300) break;
      await zoomIn.click();
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(800);
    console.log('[0] ladder prehistory done');
  }

  // ZOOM_SEQ='439,447' replays the sweep's history (toggle pair at each stop)
  // — the pen/SVG anomaly at 447% only appears when arriving from 439%.
  const seq = (process.env.ZOOM_SEQ || String(ZOOM_PCT)).split(',').map((s) => Number(s.trim())).filter(Boolean);
  for (const pct of seq) {
    console.log(`[1] set zoom ${pct}% via rail input`);
    await page.locator('button[aria-label="Edit zoom percentage"]').click();
    const inp = page.locator('input[aria-label="Zoom percentage"]');
    await inp.fill(String(pct));
    await inp.press('Enter');
    await page.waitForTimeout(1000);
    if (pct !== seq[seq.length - 1]) {
      await page.evaluate((t) => {
        const el = [...document.querySelectorAll('g[data-annotation-index] foreignObject div, [data-callout-part="text"] > div')]
          .find((d) => (d.textContent || '').includes(t));
        el?.scrollIntoView({ block: 'center', inline: 'center' });
      }, TARGET_TEXT);
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
      await page.mouse.move(2, 2);
      await page.waitForTimeout(300);
      await page.keyboard.press('e'); await page.waitForTimeout(450);
      await page.keyboard.press('p'); await page.waitForTimeout(450);
    }
  }
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll('g[data-annotation-index] foreignObject div, [data-callout-part="text"] > div')]
      .find((d) => (d.textContent || '').includes(t));
    el?.scrollIntoView({ block: 'center', inline: 'center' });
  }, TARGET_TEXT);
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);

  const region = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('g[data-annotation-index] foreignObject div, [data-callout-part="text"] > div')]
      .find((d) => (d.textContent || '').includes(t));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 16), width: r.width + 24, height: r.height + 32 };
  }, TARGET_TEXT);
  if (!region) throw new Error('target not found');
  console.log('   region', region);

  // Callout internals: where does the SVG THINK the text is (DOM geometry all
  // the way down: group → foreignObject attrs+rect → content div rect+styles)?
  const calloutDiag = () => page.evaluate((t) => {
    const div = [...document.querySelectorAll('g[data-annotation-index] foreignObject div, [data-callout-part="text"] > div')]
      .find((d) => (d.textContent || '').includes(t));
    if (!div) return null;
    const fo = div.closest('foreignObject');
    const g = div.closest('g[data-annotation-index], g');
    const rect = (el) => { const r = el?.getBoundingClientRect?.(); return r ? { x: +r.x.toFixed(3), y: +r.y.toFixed(3), w: +r.width.toFixed(3), h: +r.height.toFixed(3) } : null; };
    const cs = getComputedStyle(div);
    const inner = div.firstElementChild ? rect(div.firstElementChild) : null;
    const svg = div.closest('svg');
    return {
      svgViewBox: svg?.getAttribute('viewBox'),
      svgRect: rect(svg),
      gRect: rect(g),
      foAttrs: fo ? { x: fo.getAttribute('x'), y: fo.getAttribute('y'), w: fo.getAttribute('width'), h: fo.getAttribute('height') } : null,
      foRect: rect(fo),
      divRect: rect(div),
      innerRect: inner,
      divStyle: { fontSize: cs.fontSize, lineHeight: cs.lineHeight, paddingTop: cs.paddingTop, display: cs.display, alignItems: cs.alignItems, justifyContent: cs.justifyContent, height: cs.height, transform: cs.transform },
      scrollTop: document.querySelector('.survey-pdfjs-viewer')?.scrollTop,
    };
  }, TARGET_TEXT);

  const layerDiag = () => page.evaluate(() => {
    const out = {};
    const hostEl = document.querySelector('[data-annotation-real-surface="1"]')?.parentElement;
    if (hostEl) { const r = hostEl.getBoundingClientRect(); out.host = { x: r.x, y: r.y, w: r.width, h: r.height }; }
    const svg = document.querySelector('[data-svg-annotation-layer="1"]');
    if (svg) { const r = svg.getBoundingClientRect(); out.svg = { x: r.x, y: r.y, w: r.width, h: r.height, viewBox: svg.getAttribute('viewBox') }; }
    out.canvases = [...document.querySelectorAll('canvas')].map((c) => {
      const r = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      return {
        cls: c.className?.slice?.(0, 48) || c.getAttribute('data-annotation-canvas') || '',
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        backing: { w: c.width, h: c.height },
        styleWH: { w: c.style.width, h: c.style.height },
        display: cs.display, pos: cs.position, top: cs.top, left: cs.left, transform: cs.transform,
      };
    }).filter((c) => c.rect.w > 0 || c.display !== 'none');
    return out;
  });

  console.log('[2] PEN settled');
  await page.keyboard.press('p');
  await page.waitForTimeout(900);
  const penShot = await page.screenshot({ clip: region });
  fs.writeFileSync(path.join(ART_DIR, 'pen.png'), penShot);
  const penDiag = await layerDiag();
  console.log('\nPEN callout internals:', JSON.stringify(await calloutDiag()));

  console.log('[3] ERASER settled');
  await page.keyboard.press('e');
  await page.waitForTimeout(900);
  const eraShot = await page.screenshot({ clip: region });
  fs.writeFileSync(path.join(ART_DIR, 'eraser.png'), eraShot);
  const eraDiag = await layerDiag();

  console.log('\nPEN layers:', JSON.stringify(penDiag, null, 1).slice(0, 1600));
  console.log('\nERASER layers:', JSON.stringify(eraDiag, null, 1).slice(0, 2400));

  // Row-profile cross-correlation: how far down must the pen crop shift to
  // best match the eraser crop?
  const a = PNG.sync.read(penShot);
  const b = PNG.sync.read(eraShot);
  const rows = (png) => {
    const out = new Float64Array(png.height);
    for (let y = 0; y < png.height; y++) {
      let ink = 0;
      for (let x = 0; x < png.width; x++) {
        const i = (y * png.width + x) * 4;
        const lum = png.data[i] * 0.299 + png.data[i + 1] * 0.587 + png.data[i + 2] * 0.114;
        if (lum < 120) ink++;
      }
      out[y] = ink;
    }
    return out;
  };
  const ra = rows(a), rb = rows(b);
  let best = 0, bestScore = -Infinity;
  for (let dy = -16; dy <= 16; dy++) {
    let s = 0;
    for (let y = 0; y < a.height; y++) {
      const yb = y + dy;
      if (yb < 0 || yb >= b.height) continue;
      s += ra[y] * rb[yb];
    }
    if (s > bestScore) { bestScore = s; best = dy; }
  }
  const centroid = (r) => { let s = 0, w = 0; for (let y = 0; y < r.length; y++) { s += r[y]; w += r[y] * y; } return w / (s || 1); };
  const firstInk = (r) => { for (let y = 0; y < r.length; y++) if (r[y] > 2) return y; return -1; };
  console.log(`\nvertical shift pen→eraser: ${best} device px (row-correlation)`);
  console.log(`ink centroids: pen=${centroid(ra).toFixed(2)} eraser=${centroid(rb).toFixed(2)} Δ=${(centroid(rb) - centroid(ra)).toFixed(2)} device px`);
  console.log(`first ink row: pen=${firstInk(ra)} eraser=${firstInk(rb)} (device rows from crop top)`);
  console.log(`artifacts: ${ART_DIR}`);
} catch (e) {
  console.error('DIAG ERROR:', e.message);
  process.exitCode = 2;
} finally {
  await browser.close();
}
