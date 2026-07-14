#!/usr/bin/env node
// agent-cli/renderer-parity-e2e.mjs — cross-surface renderer parity harness.
//
// The app renders COMMITTED annotations two ways:
//   1. SVGAnnotationLayer (every tool except eraser) — the visual truth.
//   2. LightweightAnnotationOverlay's canvas2d painter (eraser mode + the
//      transient zoom/scroll proxy window) — a hand-written twin that has
//      drifted repeatedly (text baselines, callout corner rounding via leaked
//      lineJoin, callout text weight via missing textRendering, stroke scaling).
//
// This harness draws one of EVERY runtime-creatable annotation type via real
// pointer gestures, screenshots the page region once under the SVG presentation
// (select tool) and once under the canvas presentation (eraser tool), then
// pixel-diffs the two PNGs. Any future painter drift fails loudly.
//
//   node agent-cli/renderer-parity-e2e.mjs ["Doc name.pdf"]
//   BASE_URL=http://localhost:5174 node agent-cli/renderer-parity-e2e.mjs
//   HEADFUL=1 node agent-cli/renderer-parity-e2e.mjs
//
// IMPORTANT: this harness does NOT boot a dev server — point BASE_URL at a
// running one (concurrent vite instances corrupt node_modules/.vite). Dev
// auto-login comes from .env.local (VITE_DEV_AUTO_LOGIN_*) — never prompts.
//
// Covered types (drawn, diffed, then undone): pen, highlighter, rectangle,
// ellipse, line, arrow, text box, callout.
// Skipped (logged, not silent): counter + survey marker (require survey mode),
// imported-PDF annotation types (appearance-stream imports can't be created at
// runtime).
//
// Metric: a pixel "differs" if any RGB channel delta > CHANNEL_DELTA.
// FAIL if differing pixels > 0.4% of the compared page area, or if any single
// 24x24 tile is > 15% different (catches localized drift — a wrong corner,
// bolder text — even when the global average passes). Chrome that floats over
// the page (toolbar pill etc.) is tile-masked out via elementFromPoint probing
// so tool-button active-state changes between the two shots can't pollute the
// diff.
//
// CALIBRATION (2026-07-14): CHANNEL_DELTA starts at 32. The documented
// CLAUDE.md gotcha (2026-04-10) says Canvas 2D and SVG rasterizers anti-alias
// sub-pixel edges differently and this is NOT fixable in JS — if a run fails
// ONLY on uniform antialiasing fringe (thin 1-2px halos hugging every stroke
// edge, no solid mis-drawn regions), raise CHANNEL_DELTA (up to 48) rather
// than loosening the area budgets. Real drift (missing shapes, wrong corners,
// bold text, offset strokes) produces solid tile clusters that no channel
// threshold should be tuned to hide.
//
// Artifacts: agent-cli/artifacts/renderer-parity/{svg,canvas,diff}.png
// (untracked — same convention as the sibling harnesses' agent-cli/*.png).
// Exit 0 = parity PASS + cleanup returned counts to baseline. Exit 1 = FAIL.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// pngjs ships in the repo's node_modules (also pixelmatch, but the metric here
// is custom — per-channel threshold + tile budgets — so we decode with pngjs
// and do the diff ourselves). If pngjs ever disappears, fail loudly.
let PNG;
try {
  ({ PNG } = await import('pngjs'));
} catch {
  console.error('FATAL: pngjs not found in node_modules — required for the pixel diff.');
  process.exit(1);
}

const BASE_URL = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5174';
const DOC_NAME = process.argv[2] || 'repro-fixture.pdf';
const HEADLESS = process.env.HEADFUL ? false : true;

// ─── thresholds (see CALIBRATION note above) ─────────────────────────────────
const CHANNEL_DELTA = Number(process.env.CHANNEL_DELTA || 32); // per-channel 0-255
const GLOBAL_BUDGET = 0.004;  // 0.4% of compared (unmasked) page pixels
const TILE = 24;              // tile edge, px
const TILE_BUDGET = 0.15;     // any tile >15% different fails

const ART_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts', 'renderer-parity');
fs.mkdirSync(ART_DIR, { recursive: true });
const SVG_PNG = path.join(ART_DIR, 'svg.png');
const CANVAS_PNG = path.join(ART_DIR, 'canvas.png');
const DIFF_PNG = path.join(ART_DIR, 'diff.png');

let stepIndex = 0;
const step = (msg) => console.log(`[${++stepIndex}] ${msg}`);
const failures = [];
const fail = (msg) => { failures.push(msg); console.error(`   ❌ ${msg}`); };

const browser = await chromium.launch({ headless: HEADLESS });
const ctx = await browser.newContext({ viewport: { width: 1512, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message || e}`));

// ─── app-driving helpers (idioms from callout-e2e / callout-interaction-e2e) ─

const debugShot = (name) =>
  page.screenshot({ path: path.join(ART_DIR, `debug-${name}.png`) }).catch(() => {});

// All counts are PAGE-1 scoped: fixtures are drawn on page 1 and the eraser
// overlay's dataset counters ([data-lightweight-annotation-overlay="1"]) are
// per-page, so a doc with annotations on other pages must not skew the math.
const readCounts = () => page.evaluate(() => ({
  ann: document.querySelectorAll('[data-svg-annotation-layer="1"] g[data-annotation-index]').length,
  callouts: new Set([...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-callout-id]')]
    .map((e) => e.getAttribute('data-callout-id'))).size,
}));

// Trap (project memory): after any tool gesture press 'v' before DOM asserts —
// annotation DOM is only guaranteed under Select (SVG layer mounted + hit DOM).
const pressSelect = async () => {
  await page.keyboard.press('v');
  await page.waitForSelector('[data-svg-annotation-layer="1"]', { timeout: 20000 });
  await page.waitForTimeout(250);
};

const waitCountsAtLeast = async (ann, callouts, label) => {
  await page.waitForFunction(([a, c]) => {
    const annN = document.querySelectorAll('[data-svg-annotation-layer="1"] g[data-annotation-index]').length;
    const calN = new Set([...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-callout-id]')]
      .map((e) => e.getAttribute('data-callout-id'))).size;
    return annN >= a && calN >= c;
  }, [ann, callouts], { timeout: 15000 })
    .catch(async (e) => {
      await debugShot(`FAIL-count-${label}`);
      const got = await readCounts();
      throw new Error(`${label}: expected ann>=${ann} callouts>=${callouts}, got ann=${got.ann} callouts=${got.callouts} (${e.message})`);
    });
};

// A fixture spot only works if the gesture's key points land on EMPTY page —
// pointerdown on an existing annotation would drag/select it instead (and
// leftovers from prior runs accumulate). Checked in Select mode where hit DOM
// is live.
const pointsClear = (pts) => page.evaluate((points) => points.every(([x, y]) => {
  const el = document.elementFromPoint(x, y);
  return !(el && el.closest && el.closest('[data-annotation-index],[data-callout-id]'));
}), pts);

const drag = async (x1, y1, x2, y2, steps = 10) => {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(300); // shape commit fires on mouseup; let it land
};

// Pen/highlighter: a real freehand squiggle (sine wobble) so the committed
// path exercises curve rendering, not just a straight segment.
const squiggle = async (x1, y1, x2, y2) => {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + Math.sin(t * Math.PI * 3) * 10);
    await page.waitForTimeout(14);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
};

// Rect/Ellipse have no hotkey — they live in the Shapes category dropdown.
// The category button TOGGLES the dropdown: only open it when the target
// sub-tool button isn't already reachable (callout-interaction-e2e idiom).
const armShapeTool = async (title) => {
  if (await page.locator(`button[title="${title}"]`).count() === 0) {
    await page.locator('button[title="Shapes"]').first().click();
    await page.waitForTimeout(300);
  }
  await page.locator(`button[title="${title}"]`).first().click();
  await page.waitForTimeout(250);
};

// Page-region clip: page-1 host box ∩ scroller box ∩ viewport, integer-snapped
// so both screenshots decode to identical dimensions.
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

// Tile-mask any chrome floating OVER the page clip (toolbar pill, dropdowns…).
// Chrome changes between the two shots (eraser vs select button highlight), so
// diffing it would be noise. Probe 5 points per tile with elementFromPoint;
// annotation overlays are pointer-events:none so probes fall through to the
// pdf page (inside the scroller) — anything NOT inside the scroller is chrome.
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
      const probes = [
        [x0 + 1, y0 + 1], [x1, y0 + 1], [x0 + 1, y1], [x1, y1],
        [(x0 + x1) / 2, (y0 + y1) / 2],
      ];
      const isChrome = probes.some(([px, py]) => {
        const el = document.elementFromPoint(px, py);
        return !el || !(scroller && scroller.contains(el));
      });
      if (isChrome) masked.push(ty * cols + tx);
    }
  }
  return { masked, cols, rows };
}, { c: { x: clip.x, y: clip.y, width: clip.width, height: clip.height }, tile: TILE });

// Neutral state before a screenshot: close dropdowns, deselect, clear hover.
const neutralize = async (clip) => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // Click the scroller gutter left of the page (outside the page, inside the
  // scroller) — closes category dropdowns (they close on outside mousedown)
  // and deselects, without touching any annotation.
  if (clip.x - clip.scrollBox.x > 16) {
    await page.mouse.click(clip.scrollBox.x + 8, clip.y + 8);
    await page.waitForTimeout(200);
  }
  await page.keyboard.press('Escape');
  await page.mouse.move(2, 2); // park the pointer far from the page: no hover chrome
  await page.waitForTimeout(600); // let overlay scrollbars fade + paints settle
};

// ─── main flow ───────────────────────────────────────────────────────────────

let baseline = null;
let cleanupOk = false;
let parityPass = false;
const measured = { globalPct: null, worstTiles: [], maskedTiles: 0, totalTiles: 0 };

try {
  // 1. Open the app (dev auto-login) + the fixture document.
  step(`Navigating to ${BASE_URL} (dev auto-login via .env.local)…`);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  step(`Opening document "${DOC_NAME}"…`);
  const tile = page.getByText(DOC_NAME, { exact: false }).first();
  await tile.waitFor({ state: 'visible', timeout: 45000 });
  await tile.click();
  const openBtn = page.getByRole('button', { name: /open file/i }).first();
  await openBtn.waitFor({ state: 'visible', timeout: 15000 });
  await openBtn.click();

  step('Waiting for pdf.js page to paint…');
  await page.waitForSelector('.survey-pdfjs-viewer', { timeout: 30000 });
  await page.waitForFunction(() => {
    const c = [...document.querySelectorAll('.survey-pdfjs-viewer canvas, .pdf-engine-host canvas')]
      .find((el) => el.clientWidth > 80 && el.clientHeight > 80);
    return !!c;
  }, { timeout: 45000 });

  // 2. Select mode + hydration settle, then baseline counts.
  step('Arming Select + waiting for SVG layer & CRDT backfill…');
  await pressSelect();
  await page.waitForFunction(() => window.__crdtBackfillDone === true, undefined, { timeout: 20000 })
    .catch(() => console.log('   [warn] __crdtBackfillDone not seen within 20s (continuing)'));
  await page.waitForTimeout(600);
  baseline = await readCounts();
  console.log(`   baseline: ${baseline.ann} annotation(s), ${baseline.callouts} callout(s)`);

  const clip = await getClip();
  if (clip.width < 300 || clip.height < 300) {
    throw new Error(`visible page region too small for fixtures: ${clip.width}x${clip.height}`);
  }
  console.log(`   page clip: ${clip.x},${clip.y} ${clip.width}x${clip.height}`);
  const at = (fx, fy) => [clip.x + clip.width * fx, clip.y + clip.height * fy];

  // Explicit skips (not silent):
  console.log('   SKIP: counter — requires survey mode; not drawn in this harness');
  console.log('   SKIP: survey marker — requires survey mode; not drawn in this harness');
  console.log('   SKIP: imported-PDF annotation types — appearance-stream imports cannot be created at runtime');

  // 3. Draw one of each runtime-creatable type at spread-out, empty spots.
  //    Each fixture: verify spot empty (Select mode) → arm tool → gesture →
  //    'v' → wait for the committed count → Escape (deselect).
  let expectAnn = baseline.ann;
  let expectCallouts = baseline.callouts;

  const findClearSpot = async (fx, fy, keyPointsFor) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const cfx = fx + attempt * 0.05;
      const cfy = fy + attempt * 0.02;
      if (cfx > 0.95 || cfy > 0.95) break;
      if (await pointsClear(keyPointsFor(cfx, cfy))) return [cfx, cfy];
    }
    throw new Error(`no clear spot found near (${fx}, ${fy}) — page too littered; clean repro-fixture.pdf`);
  };

  const fixtures = [
    {
      name: 'pen', arm: () => page.keyboard.press('p'),
      spot: [0.08, 0.10],
      keyPoints: (fx, fy) => [at(fx, fy), at(fx + 0.16, fy + 0.12)],
      gesture: async (fx, fy) => squiggle(...at(fx, fy), ...at(fx + 0.16, fy + 0.12)),
      countsAnn: true,
    },
    {
      name: 'highlighter', arm: () => page.keyboard.press('h'),
      spot: [0.36, 0.12],
      keyPoints: (fx, fy) => [at(fx, fy), at(fx + 0.22, fy)],
      gesture: async (fx, fy) => squiggle(...at(fx, fy), ...at(fx + 0.22, fy)),
      countsAnn: true,
    },
    {
      name: 'rectangle', arm: () => armShapeTool('Rectangle'),
      spot: [0.70, 0.08],
      keyPoints: (fx, fy) => [at(fx, fy), at(fx + 0.18, fy + 0.12)],
      gesture: async (fx, fy) => drag(...at(fx, fy), ...at(fx + 0.18, fy + 0.12)),
      countsAnn: true,
    },
    {
      name: 'ellipse', arm: () => armShapeTool('Ellipse'),
      spot: [0.08, 0.30],
      keyPoints: (fx, fy) => [at(fx, fy), at(fx + 0.17, fy + 0.13)],
      gesture: async (fx, fy) => drag(...at(fx, fy), ...at(fx + 0.17, fy + 0.13)),
      countsAnn: true,
    },
    {
      name: 'line', arm: () => page.keyboard.press('l'),
      spot: [0.38, 0.30],
      keyPoints: (fx, fy) => [at(fx, fy), at(fx + 0.20, fy + 0.12)],
      gesture: async (fx, fy) => drag(...at(fx, fy), ...at(fx + 0.20, fy + 0.12)),
      countsAnn: true,
    },
    {
      name: 'arrow', arm: () => page.keyboard.press('a'),
      spot: [0.70, 0.30],
      keyPoints: (fx, fy) => [at(fx, fy), at(fx + 0.19, fy + 0.13)],
      gesture: async (fx, fy) => drag(...at(fx, fy), ...at(fx + 0.19, fy + 0.13)),
      countsAnn: true,
    },
    {
      name: 'text', arm: () => page.keyboard.press('t'),
      spot: [0.10, 0.55],
      keyPoints: (fx, fy) => [at(fx, fy)],
      gesture: async (fx, fy) => {
        await page.mouse.click(...at(fx, fy));
        // Auto-enters edit (TextEditOverlay / Fabric edit canvas). Type, then
        // commit by clicking outside — Escape would CANCEL a new annotation.
        await page.waitForSelector('[data-text-edit-overlay], .upper-canvas', { timeout: 8000 });
        await page.waitForTimeout(300);
        await page.keyboard.type('Parity test');
        await page.waitForTimeout(200);
        await page.mouse.click(...at(0.05, 0.92)); // consumed by the edit surface: commits
        await page.waitForTimeout(600);
      },
      countsAnn: true,
    },
    {
      name: 'callout', arm: () => page.keyboard.press('q'),
      spot: [0.40, 0.64],
      // tip + textbox landing zone must both be clear
      keyPoints: (fx, fy) => [at(fx, fy), at(fx + 0.17, fy - 0.08)],
      gesture: async (fx, fy) => {
        await drag(...at(fx, fy), ...at(fx + 0.17, fy - 0.08), 8);
        await page.waitForTimeout(400);
        await page.keyboard.type('Parity callout');
        await page.waitForTimeout(200);
        await page.mouse.click(...at(0.05, 0.92)); // commit (Escape would cancel)
        await page.waitForTimeout(600);
      },
      countsAnn: false, // callouts live in [data-callout-id], not g[data-annotation-index]
    },
  ];

  const createdCalloutIdsBefore = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-callout-id]')].map((e) => e.getAttribute('data-callout-id')))]);

  for (const f of fixtures) {
    step(`Drawing fixture: ${f.name}`);
    await pressSelect(); // hit-test spots with live annotation DOM
    const [fx, fy] = await findClearSpot(f.spot[0], f.spot[1], f.keyPoints);
    await f.arm();
    await page.waitForTimeout(250);
    await f.gesture(fx, fy);
    await pressSelect();
    if (f.countsAnn) expectAnn += 1; else expectCallouts += 1;
    await waitCountsAtLeast(expectAnn, expectCallouts, f.name);
    await page.keyboard.press('Escape'); // deselect anything auto-selected
    await page.waitForTimeout(150);
    console.log(`   ${f.name} committed at (${fx.toFixed(2)}, ${fy.toFixed(2)}) — counts ok`);
  }

  const ourCalloutId = await page.evaluate((before) => {
    const ids = [...new Set([...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-callout-id]')].map((e) => e.getAttribute('data-callout-id')))];
    return ids.find((id) => !before.includes(id)) || null;
  }, createdCalloutIdsBefore);
  console.log(`   our callout id: ${ourCalloutId}`);
  await debugShot('1-fixtures-drawn');

  // 4. SVG-presentation screenshot (select mode, deselected, no hover).
  step('Capturing SVG presentation (select mode)…');
  await pressSelect();
  await neutralize(clip);
  // Guard: prove which surface we're photographing — the canvas overlay must
  // be hidden in select mode, the SVG layer mounted.
  const svgModeState = await page.evaluate(() => ({
    canvasVisible: document.querySelector('[data-lightweight-annotation-overlay="1"]')?.dataset.canvasVisible,
    svgMounted: !!document.querySelector('[data-svg-annotation-layer="1"]'),
  }));
  if (svgModeState.canvasVisible === 'true' || !svgModeState.svgMounted) {
    throw new Error(`surface mixup in select mode: canvasVisible=${svgModeState.canvasVisible} svgMounted=${svgModeState.svgMounted}`);
  }
  const clipCheck1 = await getClip();
  const mask1 = await chromeMaskTiles(clip);
  await page.screenshot({ path: SVG_PNG, clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height } });
  console.log(`   svg.png saved (${clip.width}x${clip.height}), ${mask1.masked.length}/${mask1.cols * mask1.rows} tiles chrome-masked`);

  // 5. Canvas-presentation screenshot (eraser mode — do NOT click the canvas).
  step('Switching to eraser (canvas presentation)…');
  await page.keyboard.press('e');
  await page.waitForFunction(([annExp, calExp]) => {
    const wrap = document.querySelector('[data-lightweight-annotation-overlay="1"]');
    const canvas = document.querySelector('[data-annotation-presentation-canvas="1"]');
    if (!wrap || !canvas) return false;
    if (wrap.dataset.canvasVisible !== 'true') return false;
    if (Number(canvas.dataset.canvasPaintGeneration || 0) < 1) return false;
    if (Number(wrap.dataset.lightweightObjectCount || 0) < annExp) return false;
    if (Number(wrap.dataset.lightweightCalloutCount || 0) < calExp) return false;
    // eraser mode unmounts the SVG layer — required so the shot is really canvas
    if (document.querySelector('[data-svg-annotation-layer="1"]')) return false;
    return true;
  }, [expectAnn, expectCallouts], { timeout: 15000 });

  // Let the painter settle: paint generation stable across 300ms + double rAF.
  let genPrev = -1;
  for (let i = 0; i < 10; i++) {
    const gen = await page.evaluate(() =>
      Number(document.querySelector('[data-annotation-presentation-canvas="1"]')?.dataset.canvasPaintGeneration || 0));
    if (gen === genPrev) break;
    genPrev = gen;
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  // 6. Assert the canvas actually painted (a broken painter must not pass as
  //    "both empty"). Sample alpha on base + detail canvases.
  const paintStats = await page.evaluate(() => {
    const sample = (c) => {
      if (!c || !c.width || !c.height) return 0;
      try {
        const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < data.length; i += 16) if (data[i] > 8) n++; // every 4th px
        return n;
      } catch { return -1; }
    };
    const base = document.querySelector('[data-annotation-presentation-canvas="1"]');
    const detail = document.querySelector('[data-annotation-detail-canvas="1"]');
    return {
      basePainted: sample(base),
      detailPainted: sample(detail),
      gen: base?.dataset.canvasPaintGeneration,
      renderer: base?.dataset.canvasRenderer,
      objects: document.querySelector('[data-lightweight-annotation-overlay="1"]')?.dataset.lightweightObjectCount,
      callouts: document.querySelector('[data-lightweight-annotation-overlay="1"]')?.dataset.lightweightCalloutCount,
    };
  });
  console.log(`   painter: renderer=${paintStats.renderer} gen=${paintStats.gen} objects=${paintStats.objects} callouts=${paintStats.callouts} paintedSample base=${paintStats.basePainted} detail=${paintStats.detailPainted}`);
  if (Math.max(paintStats.basePainted, paintStats.detailPainted) < 200) {
    await debugShot('FAIL-canvas-blank');
    throw new Error(`eraser presentation canvas looks BLANK (sampled painted px base=${paintStats.basePainted}, detail=${paintStats.detailPainted}) — painter broken`);
  }

  step('Capturing canvas presentation (eraser mode)…');
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  const clipCheck2 = await getClip();
  const drift = Math.max(
    Math.abs(clipCheck2.x - clipCheck1.x), Math.abs(clipCheck2.y - clipCheck1.y),
    Math.abs(clipCheck2.width - clipCheck1.width), Math.abs(clipCheck2.height - clipCheck1.height));
  if (drift > 1) throw new Error(`page moved between screenshots (drift ${drift}px) — diff would be meaningless`);
  const mask2 = await chromeMaskTiles(clip);
  await page.screenshot({ path: CANVAS_PNG, clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height } });
  console.log(`   canvas.png saved, ${mask2.masked.length}/${mask2.cols * mask2.rows} tiles chrome-masked`);

  // 7. Pixel diff (in-process, pngjs).
  step('Diffing svg.png vs canvas.png…');
  const imgA = PNG.sync.read(fs.readFileSync(SVG_PNG));
  const imgB = PNG.sync.read(fs.readFileSync(CANVAS_PNG));
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    throw new Error(`screenshot dimensions differ: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`);
  }
  const { width: W, height: H } = imgA;
  const cols = Math.ceil(W / TILE);
  const rows = Math.ceil(H / TILE);
  const maskedSet = new Set([...mask1.masked, ...mask2.masked]);
  measured.maskedTiles = maskedSet.size;
  measured.totalTiles = cols * rows;
  if (maskedSet.size > cols * rows * 0.3) {
    throw new Error(`chrome mask covers ${maskedSet.size}/${cols * rows} tiles (>30%) — clip is mostly chrome, harness bug`);
  }

  const tileDiff = new Uint32Array(cols * rows);
  const tilePx = new Uint32Array(cols * rows);
  const out = new PNG({ width: W, height: H });
  let diffCount = 0;
  let compared = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const t = Math.floor(y / TILE) * cols + Math.floor(x / TILE);
      // diff viz base: dimmed grayscale of the SVG shot
      const lum = Math.round((imgA.data[i] + imgA.data[i + 1] + imgA.data[i + 2]) / 3 * 0.35);
      out.data[i] = lum; out.data[i + 1] = lum; out.data[i + 2] = lum; out.data[i + 3] = 255;
      if (maskedSet.has(t)) { out.data[i + 2] = Math.min(255, lum + 70); continue; } // blue tint = masked
      compared++;
      tilePx[t]++;
      const d = Math.max(
        Math.abs(imgA.data[i] - imgB.data[i]),
        Math.abs(imgA.data[i + 1] - imgB.data[i + 1]),
        Math.abs(imgA.data[i + 2] - imgB.data[i + 2]));
      if (d > CHANNEL_DELTA) {
        diffCount++;
        tileDiff[t]++;
        out.data[i] = 255; out.data[i + 1] = 40; out.data[i + 2] = 40;
      }
    }
  }
  fs.writeFileSync(DIFF_PNG, PNG.sync.write(out));

  const globalFrac = compared > 0 ? diffCount / compared : 0;
  measured.globalPct = (globalFrac * 100).toFixed(4);
  const tileReport = [];
  for (let t = 0; t < cols * rows; t++) {
    if (!tilePx[t]) continue;
    const frac = tileDiff[t] / tilePx[t];
    if (frac > 0) tileReport.push({ t, frac, tx: t % cols, ty: Math.floor(t / cols) });
  }
  tileReport.sort((a, b) => b.frac - a.frac);
  measured.worstTiles = tileReport.slice(0, 10).map((r) => ({
    tile: `(${r.tx},${r.ty})`,
    clipPx: `[${r.tx * TILE}..${Math.min(r.tx * TILE + TILE, W)}, ${r.ty * TILE}..${Math.min(r.ty * TILE + TILE, H)}]`,
    pct: (r.frac * 100).toFixed(1),
  }));
  const failingTiles = tileReport.filter((r) => r.frac > TILE_BUDGET);

  console.log(`   compared ${compared} px (${maskedSet.size} chrome-masked tiles excluded)`);
  console.log(`   differing pixels: ${diffCount} (${measured.globalPct}%) — budget ${(GLOBAL_BUDGET * 100).toFixed(1)}%`);
  console.log(`   worst tiles (channel delta > ${CHANNEL_DELTA}):`);
  for (const w of measured.worstTiles) console.log(`     tile ${w.tile} clip px ${w.clipPx}: ${w.pct}% different`);
  if (globalFrac > GLOBAL_BUDGET) {
    fail(`global diff ${measured.globalPct}% exceeds ${(GLOBAL_BUDGET * 100).toFixed(1)}% budget`);
  }
  if (failingTiles.length > 0) {
    fail(`${failingTiles.length} tile(s) exceed ${(TILE_BUDGET * 100).toFixed(0)}% tile budget — localized drift; see worst-tile list + ${DIFF_PNG}`);
  }
  parityPass = globalFrac <= GLOBAL_BUDGET && failingTiles.length === 0;

  // 8. Cleanup — leave repro-fixture.pdf as we found it. Undo the annotation
  //    creations (Cmd+Z per creation); the callout may not share the same
  //    history stack, so fall back to select+Delete for it (callout-e2e idiom).
  step('Cleanup: undoing created annotations…');
  await pressSelect();
  let presses = 0;
  while (presses < 18) {
    const now = await readCounts();
    if (now.ann <= baseline.ann) break;
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    presses++;
    await page.waitForTimeout(350);
  }
  let now = await readCounts();
  console.log(`   after ${presses} undo(s): ann=${now.ann} callouts=${now.callouts} (baseline ann=${baseline.ann} callouts=${baseline.callouts})`);
  if (now.callouts > baseline.callouts && ourCalloutId) {
    console.log('   callout not covered by undo — deleting via select + Delete…');
    const c = await page.evaluate((cid) => {
      const r = document.querySelector(`[data-callout-id="${cid}"] [data-callout-part="textBox"]`);
      if (!r) return null;
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, ourCalloutId);
    if (c) {
      await page.mouse.click(c.x, c.y);
      await page.waitForTimeout(400);
      await page.keyboard.press('Delete');
      await page.waitForTimeout(600);
    }
  }
  await page.waitForFunction(([a, c]) => {
    const annN = document.querySelectorAll('[data-svg-annotation-layer="1"] g[data-annotation-index]').length;
    const calN = new Set([...document.querySelectorAll('[data-svg-annotation-layer="1"] [data-callout-id]')]
      .map((e) => e.getAttribute('data-callout-id'))).size;
    return annN === a && calN === c;
  }, [baseline.ann, baseline.callouts], { timeout: 8000 }).catch(() => {});
  now = await readCounts();
  cleanupOk = now.ann === baseline.ann && now.callouts === baseline.callouts;
  if (!cleanupOk) {
    fail(`cleanup incomplete: ann=${now.ann}/${baseline.ann} callouts=${now.callouts}/${baseline.callouts} — repro-fixture.pdf has leftovers`);
    await debugShot('FAIL-cleanup');
  } else {
    console.log('   cleanup OK — document back at baseline counts');
  }
} catch (e) {
  fail(`harness error: ${e.message}`);
  await debugShot('FAIL-unexpected');
} finally {
  await browser.close();
}

// ─── summary ─────────────────────────────────────────────────────────────────
const realConsoleErrors = consoleErrors.filter((m) => !/favicon|React DevTools|Failed to load resource/.test(m));
if (realConsoleErrors.length) {
  console.log(`\n[warn] ${realConsoleErrors.length} console error(s), first 3: ${realConsoleErrors.slice(0, 3).join(' | ')}`);
}
console.log('\n──────── renderer parity summary ────────');
console.log(`thresholds: channelDelta=${CHANNEL_DELTA} globalBudget=${(GLOBAL_BUDGET * 100).toFixed(1)}% tile=${TILE}px tileBudget=${(TILE_BUDGET * 100).toFixed(0)}%`);
console.log(`measured:   globalDiff=${measured.globalPct ?? 'n/a'}%  maskedTiles=${measured.maskedTiles}/${measured.totalTiles}`);
console.log(`skipped types: counter, survey marker (survey mode required); imported-PDF types (not creatable at runtime)`);
console.log(`artifacts:  ${SVG_PNG}\n            ${CANVAS_PNG}\n            ${DIFF_PNG}`);
if (failures.length === 0) {
  console.log('\n✅ PASS: SVG and canvas2d presentations match within thresholds; fixtures undone.');
} else {
  console.log(`\n❌ FAIL: ${failures.length} problem(s):`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exitCode = 1;
}
