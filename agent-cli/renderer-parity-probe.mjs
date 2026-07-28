#!/usr/bin/env node
/**
 * renderer-parity-probe.mjs — DIAGNOSTIC twin of renderer-parity-e2e.mjs.
 *
 * Draws NOTHING: it opens an existing document as-is, captures the page region
 * under the SVG presentation (Select) and the canvas presentation (eraser),
 * pixel-diffs them, and — the diagnostic part — cross-correlates each hot
 * tile vertically/horizontally to report the actual (dx, dy) drift of the
 * canvas ink relative to the SVG ink. Use it to reproduce "X jumps when I
 * switch to the eraser" reports numerically on the exact document the user
 * is looking at.
 *
 *   BASE_URL=http://localhost:5174 node agent-cli/renderer-parity-probe.mjs 'clickable-link-test.pdf'
 *
 * Never boots a vite server (concurrent instances corrupt node_modules/.vite).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { assertBrowserUsesLeasedAccount, installLeasedBrowserAccount } from './lib/leased-browser-session.mjs';

let PNG;
try {
  ({ PNG } = await import('pngjs'));
} catch {
  console.error('pngjs not found in node_modules'); process.exit(2);
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const DOC_NAME = process.argv[2] || 'clickable-link-test.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;
const CHANNEL_DELTA = Number(process.env.CHANNEL_DELTA || 32);
const TILE = 24;

const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts', 'renderer-parity-probe');
fs.mkdirSync(ART_DIR, { recursive: true });
const SVG_PNG = path.join(ART_DIR, 'svg.png');
const CANVAS_PNG = path.join(ART_DIR, 'canvas.png');
const DIFF_PNG = path.join(ART_DIR, 'diff.png');

let stepIndex = 0;
const step = (msg) => console.log(`[${++stepIndex}] ${msg}`);

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const getClip = async () => {
  const pageBox = await page.locator('[data-annotation-real-surface="1"]').boundingBox();
  const scrollBox = await page.locator('.survey-pdfjs-viewer').boundingBox();
  const vp = page.viewportSize();
  if (!pageBox || !scrollBox) throw new Error('page host / scroller bounding box not found');
  const x1 = Math.ceil(Math.max(pageBox.x, scrollBox.x, 0));
  const y1 = Math.ceil(Math.max(pageBox.y, scrollBox.y, 0));
  const x2 = Math.floor(Math.min(pageBox.x + pageBox.width, scrollBox.x + scrollBox.width, vp.width));
  const y2 = Math.floor(Math.min(pageBox.y + pageBox.height, scrollBox.y + scrollBox.height, vp.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1, pageBox, scrollBox };
};

const chromeMaskTiles = (clip) => page.evaluate(({ c, tile }) => {
  const scroller = document.querySelector('.survey-pdfjs-viewer');
  const cols = Math.ceil(c.width / tile);
  const rows = Math.ceil(c.height / tile);
  const masked = [];
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = c.x + tx * tile, y0 = c.y + ty * tile;
      const x1 = Math.min(x0 + tile - 1, c.x + c.width - 1);
      const y1 = Math.min(y0 + tile - 1, c.y + c.height - 1);
      const probes = [[x0 + 1, y0 + 1], [x1, y0 + 1], [x0 + 1, y1], [x1, y1], [(x0 + x1) / 2, (y0 + y1) / 2]];
      if (probes.some(([px, py]) => {
        const el = document.elementFromPoint(px, py);
        return !el || !(scroller && scroller.contains(el));
      })) masked.push(ty * cols + tx);
    }
  }
  return { masked: new Set(masked), maskedArr: masked, cols, rows };
}, { c: { x: clip.x, y: clip.y, width: clip.width, height: clip.height }, tile: TILE });

const neutralize = async (clip, allowClick = true) => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // Margin click deselects in Select mode. Skip it when a drawing tool is
  // armed (SVG_MODE=p) — a pen click would CREATE ink between the shots.
  if (allowClick && clip.x - clip.scrollBox.x > 16) {
    await page.mouse.click(clip.scrollBox.x + 8, clip.y + 8);
    await page.waitForTimeout(200);
  }
  await page.keyboard.press('Escape');
  await page.mouse.move(2, 2);
  await page.waitForTimeout(600);
};

// TARGET_TEXT: center the annotation whose text contains the given string and
// report its tiles' drift explicitly (user bug reports name an annotation,
// not a tile index). Returns the match's viewport rect for the diff step.
const TARGET_TEXT = process.env.TARGET_TEXT || null;
const findTarget = () => page.evaluate((needle) => {
  const layer = document.querySelector('[data-svg-annotation-layer="1"]');
  if (!layer) return null;
  const groups = [...layer.querySelectorAll('g[data-annotation-index], g[data-callout-id]')];
  for (const g of groups) {
    const div = g.querySelector('foreignObject div');
    const textEl = g.querySelector('text');
    const holder = div || textEl;
    if (!holder) continue;
    if (!(holder.textContent || '').includes(needle)) continue;
    const r = holder.getBoundingClientRect();
    return {
      id: g.getAttribute('data-annotation-index') || g.getAttribute('data-callout-id'),
      l: r.left, t: r.top, w: r.width, h: r.height,
      text: (holder.textContent || '').slice(0, 24),
    };
  }
  return null;
}, TARGET_TEXT);

try {
  step(`Navigating to ${BASE_URL} …`);
  const leasedBrowserAccount = await installLeasedBrowserAccount(page);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await assertBrowserUsesLeasedAccount(page, { account: leasedBrowserAccount });

  step(`Opening document "${DOC_NAME}"…`);
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 45000 });
  await tile.click();
  const openBtn = page.getByRole('button', { name: /open file/i }).first();
  await openBtn.waitFor({ state: 'visible', timeout: 15000 });
  await openBtn.click();

  step('Waiting for pdf.js page paint + SVG layer…');
  await page.waitForSelector('.survey-pdfjs-viewer', { timeout: 30000 });
  await page.keyboard.press('v');
  await page.waitForSelector('[data-svg-annotation-layer="1"]', { timeout: 20000 });
  await page.waitForFunction(() => window.__crdtBackfillDone === true, undefined, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);

  // Self-documenting fix marker: confirm the SERVED painter carries the
  // 2026-07-14 baseline-snap fix, so a probe log can never silently gate
  // against a stale build (a fresh probe navigation always runs served code).
  const hasSnapFix = await page.evaluate(() => fetch('/src/utils/annotationCanvasPainter.js')
    .then((r) => r.text())
    .then((t) => t.includes('paintBlockTop'))
    .catch(() => null));
  console.log(`   served painter has baseline-snap fix: ${hasSnapFix}`);

  const counts = await page.evaluate(() => ({
    ann: document.querySelectorAll('[data-svg-annotation-layer="1"] g[data-annotation-index]').length,
    callouts: new Set([...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-callout-id]')]
      .map((e) => e.getAttribute('data-callout-id'))).size,
  }));
  console.log(`   existing annotations: ${counts.ann}, callouts: ${counts.callouts}`);

  // ZOOM_CLICKS: zoom in N steps before capturing — a painter GEOMETRY error
  // grows with zoom (page-unit drift), rasterizer noise stays ≤1 device px.
  const zoomClicks = Number(process.env.ZOOM_CLICKS || 0);
  if (zoomClicks > 0) {
    const zoomIn = page.locator('#chrome-right-host button[aria-label="Zoom in"]').first();
    for (let i = 0; i < zoomClicks; i++) { await zoomIn.click(); await page.waitForTimeout(250); }
    await page.waitForTimeout(1200); // zoom settle + repaints
    console.log(`   zoomed in ${zoomClicks} steps`);
  }
  if (zoomClicks > 0 || TARGET_TEXT) {
    // Keep a content-dense region in view: center TARGET_TEXT's annotation
    // when given, else the first counter pin / first annotation.
    await page.evaluate((needle) => {
      let t = null;
      if (needle) {
        t = [...document.querySelectorAll('[data-svg-annotation-layer="1"] foreignObject div, [data-svg-annotation-layer="1"] g text')]
          .find((n) => (n.textContent || '').includes(needle)) || null;
      }
      t = t
        || [...document.querySelectorAll('g[data-annotation-index] text')].find((n) => /^\d+$/.test(n.textContent.trim()))
        || document.querySelector('g[data-annotation-index]');
      t?.scrollIntoView({ block: 'center', inline: 'center' });
    }, TARGET_TEXT);
    await page.waitForTimeout(600);
  }
  const pageScale = await page.evaluate(() => {
    const host = document.querySelector('[data-annotation-real-surface="1"]');
    return host ? host.getBoundingClientRect().width : 0;
  }).then((w) => w / 612);
  console.log(`   pageScale ~${pageScale.toFixed(4)} (host width / 612)`);

  // SVG_MODE=p captures the SVG presentation with the PEN armed instead of
  // Select — the user's toggle recipe is E<->P, and a pen-mode-only overlay
  // nudging the page would be invisible to the Select-mode capture.
  const svgModeKey = (process.env.SVG_MODE || 'v').toLowerCase();
  if (svgModeKey !== 'v') {
    await page.keyboard.press(svgModeKey);
    await page.waitForSelector('[data-svg-annotation-layer="1"]', { timeout: 10000 });
    await page.waitForTimeout(400);
    console.log(`   SVG capture mode: '${svgModeKey}'`);
  }

  step(`Capturing SVG presentation ('${svgModeKey}' mode)…`);
  const clip = await getClip();
  await neutralize(clip, svgModeKey === 'v');
  const targetRect = TARGET_TEXT ? await findTarget() : null;
  if (TARGET_TEXT) {
    console.log(targetRect
      ? `   target "${TARGET_TEXT}" -> ${targetRect.id} "${targetRect.text}" @ viewport (${targetRect.l.toFixed(1)}, ${targetRect.t.toFixed(1)}, ${targetRect.w.toFixed(1)}x${targetRect.h.toFixed(1)})`
      : `   target "${TARGET_TEXT}" NOT FOUND in SVG layer`);
  }
  const mask1 = await chromeMaskTiles(clip);
  await page.screenshot({ path: SVG_PNG, clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height } });

  // DIAG=1 — dump every SVG annotation intersecting the clip with its exact
  // line-box rects (Range.getClientRects = the browser's own layout truth for
  // foreignObject text), so canvas glyph placement can be compared numerically.
  if (process.env.DIAG) {
    const svgDiag = await page.evaluate((c) => {
      const out = [];
      const inClip = (r) => r.right > c.x && r.left < c.x + c.width && r.bottom > c.y && r.top < c.y + c.height;
      const rect = (r) => ({ l: +r.left.toFixed(3), t: +r.top.toFixed(3), w: +r.width.toFixed(3), h: +r.height.toFixed(3) });
      for (const g of document.querySelectorAll('[data-svg-annotation-layer="1"] g[data-annotation-index], [data-svg-annotation-layer="1"] g[data-callout-id]')) {
        const r = g.getBoundingClientRect();
        if (!inClip(r)) continue;
        const entry = {
          index: g.getAttribute('data-annotation-index'),
          calloutId: g.getAttribute('data-callout-id'),
          transform: g.getAttribute('transform'),
          rect: rect(r),
        };
        const div = g.querySelector('foreignObject div');
        if (div) {
          entry.text = (div.textContent || '').slice(0, 40);
          const s = div.getAttribute('style') || '';
          entry.style = s.slice(0, 300);
          entry.divRect = rect(div.getBoundingClientRect());
          const fo = g.querySelector('foreignObject');
          entry.foAttrs = { x: fo.getAttribute('x'), y: fo.getAttribute('y'), w: fo.getAttribute('width'), h: fo.getAttribute('height') };
          const tn = [...div.childNodes].find((n) => n.nodeType === 3);
          if (tn) {
            const range = document.createRange();
            range.selectNodeContents(tn);
            entry.lineRects = [...range.getClientRects()].slice(0, 4).map(rect);
          }
          // Real first-baseline offset inside the LIVE foreignObject, in
          // viewport CSS px (already scaled by the SVG CTM). The div is a flex
          // container, so a marker span cannot join the text's inline flow
          // directly (it would become its own flex item). Instead:
          //   R_flex = first line-box text rect top under the real flex layout
          //   R_block/B_block = same rect top + marker baseline with the div
          //     temporarily display:block (marker joins the inline flow there)
          //   real baseline = R_flex + (B_block − R_block)
          try {
            const tn2 = [...div.childNodes].find((n) => n.nodeType === 3);
            if (tn2) {
              const divTop = () => div.getBoundingClientRect().top;
              const textTop = () => {
                const range = document.createRange();
                range.selectNodeContents(tn2);
                return range.getClientRects()[0]?.top ?? NaN;
              };
              const rFlex = textTop() - divTop();
              const prevDisplay = div.style.display;
              div.style.display = 'block';
              const rBlock = textTop() - divTop();
              const marker = document.createElement('span');
              marker.style.display = 'inline-block';
              marker.style.width = '0';
              marker.style.height = '0';
              div.insertBefore(marker, tn2);
              const bBlock = marker.getBoundingClientRect().bottom - divTop();
              marker.remove();
              div.style.display = prevDisplay;
              entry.liveBaselineOffset = +(rFlex + (bBlock - rBlock)).toFixed(4);
              entry.liveParts = {
                rFlex: +rFlex.toFixed(4),
                rBlock: +rBlock.toFixed(4),
                bBlock: +bBlock.toFixed(4),
              };
            }
          } catch { /* diagnostic only */ }
          // The painter's prediction for the same font: replicate
          // cssFirstBaseline's DOM probe (UNscaled document coordinates).
          try {
            const cs = getComputedStyle(div);
            const probe = document.createElement('div');
            probe.style.position = 'fixed';
            probe.style.visibility = 'hidden';
            probe.style.left = '-9999px';
            probe.style.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            probe.style.lineHeight = cs.lineHeight;
            probe.textContent = 'Hg';
            const pm = document.createElement('span');
            pm.style.display = 'inline-block';
            pm.style.width = '0';
            pm.style.height = '0';
            probe.appendChild(pm);
            document.body.appendChild(probe);
            entry.probeBaselineOffset = +(pm.getBoundingClientRect().bottom
              - probe.getBoundingClientRect().top).toFixed(4);
            entry.probeInputs = { fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontFamily: cs.fontFamily };
            probe.remove();
          } catch { /* diagnostic only */ }
        }
        const textEl = g.querySelector('text');
        if (textEl) {
          entry.svgText = (textEl.textContent || '').slice(0, 20);
          entry.svgTextRect = rect(textEl.getBoundingClientRect());
        }
        out.push(entry);
      }
      const host = document.querySelector('[data-annotation-real-surface="1"]');
      return { hostRect: rect(host.getBoundingClientRect()), annotations: out };
    }, { x: clip.x, y: clip.y, width: clip.width, height: clip.height });
    console.log('   DIAG clip:', JSON.stringify({ x: clip.x, y: clip.y, w: clip.width, h: clip.height }));
    console.log('   DIAG svg-side:', JSON.stringify(svgDiag, null, 1));
  }

  step('Switching to eraser (canvas presentation)…');
  // TOGGLES=n replays the user's E<->P thrash before the capture — a repaint
  // skipped on re-entry (stale payload / generation cache) only shows up
  // after repeated presentation swaps.
  const toggles = Number(process.env.TOGGLES || 0);
  for (let i = 0; i < toggles; i++) {
    await page.keyboard.press(i % 2 === 0 ? 'e' : 'p');
    await page.waitForTimeout(350);
  }
  if (toggles > 0) console.log(`   toggled eraser<->pen ${toggles} times`);
  await page.keyboard.press('e');
  // BURST=n: grab n raw frames immediately after the eraser keypress, BEFORE
  // any settle waits — hunts transient wrong-position frames during the
  // presentation swap that the settled capture can never show.
  const burstN = Number(process.env.BURST || 0);
  const burstTimes = [];
  if (burstN > 0) {
    const t0 = Date.now();
    for (let i = 0; i < burstN; i++) {
      await page.screenshot({
        path: path.join(ART_DIR, `burst-${i}.png`),
        clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
      });
      burstTimes.push(Date.now() - t0);
    }
    console.log(`   burst: ${burstN} frames at +${burstTimes.join('ms, +')}ms after 'e'`);
  }
  await page.waitForFunction(([annExp, calExp]) => {
    const wrap = document.querySelector('[data-lightweight-annotation-overlay="1"]');
    const canvas = document.querySelector('[data-annotation-presentation-canvas="1"]');
    if (!wrap || !canvas) return false;
    if (wrap.dataset.canvasVisible !== 'true') return false;
    if (Number(canvas.dataset.canvasPaintGeneration || 0) < 1) return false;
    if (Number(wrap.dataset.lightweightObjectCount || 0) < annExp) return false;
    if (Number(wrap.dataset.lightweightCalloutCount || 0) < calExp) return false;
    if (document.querySelector('[data-svg-annotation-layer="1"]')) return false;
    return true;
  }, [counts.ann, counts.callouts], { timeout: 15000 });
  let genPrev = -1;
  for (let i = 0; i < 10; i++) {
    const gen = await page.evaluate(() =>
      Number(document.querySelector('[data-annotation-presentation-canvas="1"]')?.dataset.canvasPaintGeneration || 0));
    if (gen === genPrev) break;
    genPrev = gen;
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  const clip2 = await getClip();
  const drift = Math.max(Math.abs(clip2.x - clip.x), Math.abs(clip2.y - clip.y));
  if (drift > 1) throw new Error(`page moved between shots (${drift}px)`);
  const mask2 = await chromeMaskTiles(clip);
  await page.screenshot({ path: CANVAS_PNG, clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height } });

  // DIAG=1 — which canvas surface is actually visible, with its exact CSS box,
  // backing dims, and painter transform datasets.
  if (process.env.DIAG) {
    const canvasDiag = await page.evaluate(() => {
      const rect = (r) => ({ l: +r.left.toFixed(3), t: +r.top.toFixed(3), w: +r.width.toFixed(3), h: +r.height.toFixed(3) });
      const dump = (el) => el && {
        dataset: { ...el.dataset },
        cssText: el.style.cssText,
        display: getComputedStyle(el).display,
        backing: { w: el.width, h: el.height },
        rect: rect(el.getBoundingClientRect()),
      };
      const wrap = document.querySelector('[data-lightweight-annotation-overlay="1"]');
      return {
        wrap: wrap && { dataset: { ...wrap.dataset }, rect: rect(wrap.getBoundingClientRect()) },
        base: dump(document.querySelector('[data-annotation-presentation-canvas="1"]')),
        detail: dump(document.querySelector('[data-annotation-detail-canvas="1"]')),
        dpr: window.devicePixelRatio,
      };
    });
    console.log('   DIAG canvas-side:', JSON.stringify(canvasDiag, null, 1));

    // Where did fillText ACTUALLY land inside the live canvas backing store?
    // Scan a backing-pixel window (env DIAG_INK="x0,x1,y0,y1" in backing px)
    // of the visible canvas for ink rows — bypasses all CSS/compositor
    // mapping, isolating painter-internal placement.
    if (process.env.DIAG_INK) {
      const [ix0, ix1, iy0, iy1] = process.env.DIAG_INK.split(',').map(Number);
      const inkDiag = await page.evaluate(({ x0, x1, y0, y1 }) => {
        const detail = document.querySelector('[data-annotation-detail-canvas="1"]');
        const base = document.querySelector('[data-annotation-presentation-canvas="1"]');
        const canvas = detail?.dataset.annotationDetailActive === 'true' ? detail : base;
        const context = canvas.getContext('2d');
        const img = context.getImageData(x0, y0, x1 - x0, y1 - y0);
        const rows = [];
        for (let y = 0; y < y1 - y0; y++) {
          let s = 0;
          for (let x = 0; x < x1 - x0; x++) {
            const i = (y * (x1 - x0) + x) * 4;
            const alpha = img.data[i + 3] / 255;
            const l = img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114;
            s += (255 - l) * alpha;
          }
          if (s > 50) rows.push([y0 + y, Math.round(s)]);
        }
        return { which: canvas === detail ? 'detail' : 'base', rows };
      }, { x0: ix0, x1: ix1, y0: iy0, y1: iy1 });
      console.log('   DIAG ink rows (backing px):', JSON.stringify(inkDiag));
    }
  }

  step('Diffing + measuring per-tile drift…');
  const imgA = PNG.sync.read(fs.readFileSync(SVG_PNG));
  const imgB = PNG.sync.read(fs.readFileSync(CANVAS_PNG));
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) throw new Error('shot dims differ');
  const W = imgA.width, H = imgA.height;
  const scale = W / clip.width; // device px per CSS px (deviceScaleFactor)
  const cols = Math.ceil(clip.width / TILE), rows = Math.ceil(clip.height / TILE);
  const masked = new Set([...mask1.maskedArr, ...mask2.maskedArr]);

  const out = new PNG({ width: W, height: H });
  imgA.data.copy(out.data);
  const tileDiff = new Map();
  let diffPixels = 0, totalPixels = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cssX = x / scale, cssY = y / scale;
      const t = Math.floor(cssY / TILE) * cols + Math.floor(cssX / TILE);
      if (masked.has(t)) continue;
      totalPixels++;
      const i = (y * W + x) * 4;
      const d = Math.max(
        Math.abs(imgA.data[i] - imgB.data[i]),
        Math.abs(imgA.data[i + 1] - imgB.data[i + 1]),
        Math.abs(imgA.data[i + 2] - imgB.data[i + 2]));
      if (d > CHANNEL_DELTA) {
        diffPixels++;
        tileDiff.set(t, (tileDiff.get(t) || 0) + 1);
        out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255;
      }
    }
  }
  fs.writeFileSync(DIFF_PNG, PNG.sync.write(out));

  // Cross-correlate the hottest tiles: find (dx, dy) in device px minimizing
  // the SAD between the SVG tile and the SHIFTED canvas tile — the measured
  // drift of the canvas ink for that region.
  const lum = (img, x, y) => {
    const i = (y * W + x) * 4;
    return img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114;
  };
  const measureShift = (t, img = imgB) => {
    const tx = (t % cols) * TILE * scale, ty = Math.floor(t / cols) * TILE * scale;
    const tw = Math.min(TILE * scale, W - tx), th = Math.min(TILE * scale, H - ty);
    let best = { dx: 0, dy: 0, sad: Infinity };
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        let sad = 0;
        for (let y = 8; y < th - 8; y += 2) {
          for (let x = 8; x < tw - 8; x += 2) {
            const ax = tx + x, ay = ty + y;
            sad += Math.abs(lum(imgA, ax, ay) - lum(img, ax + dx, ay + dy));
          }
        }
        if (sad < best.sad) best = { dx, dy, sad };
      }
    }
    return best;
  };

  const hot = [...tileDiff.entries()]
    .map(([t, n]) => ({ t, pct: n / (TILE * scale * TILE * scale) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 12);

  const pct = totalPixels ? (diffPixels / totalPixels) * 100 : 0;
  console.log(`\n──────── probe results (${DOC_NAME}) ────────`);
  console.log(`global diff: ${pct.toFixed(4)}% (${diffPixels}/${totalPixels} px, channel delta ${CHANNEL_DELTA}, dpr-scale ${scale})`);

  // Focused drift table for the TARGET_TEXT annotation: every tile its rect
  // touches, whether or not it makes the global top-12.
  if (targetRect) {
    const pad = 4; // css px around the rect so edge AA lands in the window
    const c0 = Math.max(0, Math.floor((targetRect.l - pad - clip.x) / TILE));
    const c1 = Math.min(cols - 1, Math.floor((targetRect.l + targetRect.w + pad - clip.x) / TILE));
    const r0 = Math.max(0, Math.floor((targetRect.t - pad - clip.y) / TILE));
    const r1 = Math.min(rows - 1, Math.floor((targetRect.t + targetRect.h + pad - clip.y) / TILE));
    console.log(`TARGET "${TARGET_TEXT}" tiles (cols ${c0}..${c1}, rows ${r0}..${r1}):`);
    let worst = { pct: 0, dx: 0, dy: 0 };
    for (let r = r0; r <= r1; r++) {
      for (let cCol = c0; cCol <= c1; cCol++) {
        const t = r * cols + cCol;
        if (masked.has(t)) { console.log(`  TARGET tile (${cCol},${r}) masked`); continue; }
        const n = tileDiff.get(t) || 0;
        const tp = (n / (TILE * scale * TILE * scale)) * 100;
        if (tp < 0.05) continue;
        const s = measureShift(t);
        if (tp > worst.pct) worst = { pct: tp, dx: s.dx, dy: s.dy };
        console.log(`  TARGET tile (${cCol},${r}) ${tp.toFixed(1)}% diff — shift dx=${s.dx} dy=${s.dy} device px`);
      }
    }
    console.log(`TARGET summary: worst ${worst.pct.toFixed(1)}% dx=${worst.dx} dy=${worst.dy} (zoomClicks=${process.env.ZOOM_CLICKS || 0}, toggles=${process.env.TOGGLES || 0}, svgMode=${svgModeKey}, pageScale=${pageScale.toFixed(4)})`);

    // Burst frames: target drift per raw post-keypress frame vs the SVG shot.
    for (let bi = 0; bi < burstTimes.length; bi++) {
      const framePath = path.join(ART_DIR, `burst-${bi}.png`);
      if (!fs.existsSync(framePath)) continue;
      const imgF = PNG.sync.read(fs.readFileSync(framePath));
      if (imgF.width !== W || imgF.height !== H) { console.log(`  BURST[${bi}] dims differ — skipped`); continue; }
      let bWorst = { pct: 0, dx: 0, dy: 0, tile: null };
      for (let r = r0; r <= r1; r++) {
        for (let cCol = c0; cCol <= c1; cCol++) {
          const t = r * cols + cCol;
          if (masked.has(t)) continue;
          let n = 0;
          const tx0 = Math.round(cCol * TILE * scale), ty0 = Math.round(r * TILE * scale);
          const tx1 = Math.min(Math.round((cCol + 1) * TILE * scale), W);
          const ty1 = Math.min(Math.round((r + 1) * TILE * scale), H);
          for (let y = ty0; y < ty1; y++) {
            for (let x = tx0; x < tx1; x++) {
              const i = (y * W + x) * 4;
              const d = Math.max(
                Math.abs(imgA.data[i] - imgF.data[i]),
                Math.abs(imgA.data[i + 1] - imgF.data[i + 1]),
                Math.abs(imgA.data[i + 2] - imgF.data[i + 2]));
              if (d > CHANNEL_DELTA) n++;
            }
          }
          const tp = (n / ((tx1 - tx0) * (ty1 - ty0))) * 100;
          if (tp > bWorst.pct) {
            const s = measureShift(t, imgF);
            bWorst = { pct: tp, dx: s.dx, dy: s.dy, tile: `(${cCol},${r})` };
          }
        }
      }
      console.log(`  BURST[${bi}] +${burstTimes[bi]}ms: worst target tile ${bWorst.tile ?? '-'} ${bWorst.pct.toFixed(1)}% dx=${bWorst.dx} dy=${bWorst.dy}`);
    }
  }
  for (const { t, pct: tp } of hot) {
    const cx = (t % cols) * TILE, cy = Math.floor(t / cols) * TILE;
    const s = measureShift(t);
    console.log(`  tile (${t % cols},${Math.floor(t / cols)}) cssClip[${cx}..${cx + TILE}, ${cy}..${cy + TILE}] ${(tp * 100).toFixed(1)}% diff — best-fit canvas shift dx=${s.dx} dy=${s.dy} device px (${(s.dx / scale).toFixed(1)}, ${(s.dy / scale).toFixed(1)} css px)`);
  }
  console.log(`artifacts: ${SVG_PNG}\n           ${CANVAS_PNG}\n           ${DIFF_PNG}`);
} catch (e) {
  console.error(`PROBE ERROR: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
