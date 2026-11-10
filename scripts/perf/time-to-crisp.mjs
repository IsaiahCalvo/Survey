#!/usr/bin/env node
// How long after a gesture ends until everything on screen is sharp and its
// marks show (owner 2026-11-10: "pages loading as fast as possible,
// annotations loading as fast as possible ... after zoom, after scroll, after
// panning, fast to all extremes").
//
// LOCAL e2e stack only (signs in as the e2e owner; every non-local request is
// aborted). Serve a build with `npx vite preview --mode e2e`, then:
//   BASE=http://127.0.0.1:5242 node scripts/perf/time-to-crisp.mjs
// PHONE=iphone|pixel (APP=ios|android) for the phone layouts. ONLY=a,b runs
// some gestures. CPU=4 slows the CPU. PROFILE=<path prefix> saves a CPU
// profile of each gesture and what follows; TRACE=<path prefix> a Chrome trace.
//
// Each animation frame after the gesture ends it records, for every page on
// screen, how sharp it is (bitmap pixels per device pixel, from the deep-zoom
// tile where that covers the view, else the page drawing) and how many marks
// show. "sharp" = ms until the least sharp page on screen reaches 90% of where
// it ends up and stays there; "final" = that end value; "marks" = ms until the
// count of marks on screen stops changing; "blank" = ms until no page on
// screen is an empty sheet; "still" = ms until the view stops moving (a
// finger swipe coasts on), "afterStill" = sharp minus still; "maxGap" = the
// longest wait between two frames (a freeze); "mounts" = pages that got
// their drawing and marks mounted after the gesture ended.
import fs from 'node:fs';
import { chromium, devices } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:5242';
const DOC = process.env.BIG_DOC_NAME || 'Package 2 Rev 4.pdf';
const RUNS = Number(process.env.RUNS || 1);
const CPU = Number(process.env.CPU || 1);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const WATCH_MS = Number(process.env.WATCH_MS || 4000);
const PHONE = process.env.PHONE ? devices[{ iphone: 'iPhone 13', pixel: 'Pixel 7' }[process.env.PHONE] || process.env.PHONE] : null;
const exe = process.env.PW_CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Installed once; window.__crisp.start() begins a fresh recording.
function installProbe() {
  const sample = () => {
    const first = document.querySelector('.survey-pdfjs-page-div');
    const scroller = first?.closest('[data-pdfjs-scroller], .survey-pdfjs-scroller') || first?.parentElement?.parentElement;
    if (!scroller) return null;
    const sr = scroller.getBoundingClientRect();
    let minRes = Infinity; let marks = 0; let pages = 0; let blank = 0; let pos = null;
    for (const page of document.querySelectorAll('.survey-pdfjs-page-div[data-page-number]')) {
      const pr = page.getBoundingClientRect();
      const x0 = Math.max(pr.left, sr.left); const x1 = Math.min(pr.right, sr.right);
      const y0 = Math.max(pr.top, sr.top); const y1 = Math.min(pr.bottom, sr.bottom);
      if (x1 - x0 < 8 || y1 - y0 < 8) continue;
      pages += 1;
      if (pos === null) pos = `${page.dataset.pageNumber}:${Math.round(pr.left)},${Math.round(pr.top)},${Math.round(pr.width)}`;
      const area = (x1 - x0) * (y1 - y0);
      const base = page.querySelector('.survey-pdfjs-page-canvas');
      const baseShown = base && base.width > 1 && getComputedStyle(base).visibility !== 'hidden' && base.style.display !== 'none';
      let res = baseShown ? base.width / (pr.width * devicePixelRatio) : 0;
      const tile = page.querySelector('.survey-pdfjs-detail-tile');
      if (tile && tile.style.display !== 'none' && tile.width > 1) {
        const tr = tile.getBoundingClientRect();
        const cover = Math.max(0, Math.min(x1, tr.right) - Math.max(x0, tr.left)) * Math.max(0, Math.min(y1, tr.bottom) - Math.max(y0, tr.top));
        if (cover / area >= 0.95) res = Math.max(res, tile.width / (tr.width * devicePixelRatio));
      }
      if (!baseShown) blank += 1;
      minRes = Math.min(minRes, res);
      marks += document.querySelectorAll(`[data-overlay-page="${page.dataset.pageNumber}"] [data-annotation-index]`).length;
    }
    return { minRes: pages ? minRes : 0, marks, pages, blank, pos };
  };
  window.__crisp = {
    rows: [],
    running: false,
    start() {
      this.rows = []; this.running = true; const t0 = performance.now();
      const mountedAtStart = new Set([...document.querySelectorAll('.survey-pdfjs-page-div[data-page-mounted="true"]')].map((el) => el.dataset.pageNumber));
      this.mounts = new Set();
      const tick = () => {
        if (!this.running) return;
        for (const el of document.querySelectorAll('.survey-pdfjs-page-div[data-page-mounted="true"]')) {
          if (!mountedAtStart.has(el.dataset.pageNumber)) this.mounts.add(el.dataset.pageNumber);
        }
        const s = sample();
        if (s) this.rows.push({ t: Math.round(performance.now() - t0), ...s });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    stop() { this.running = false; return Object.assign(this.rows, { mounts: this.mounts?.size || 0 }); },
  };
}

function summarise(rows) {
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const final = last.minRes;
  let sharp = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) { if (rows[i].minRes < final * 0.9) { sharp = rows[i + 1]?.t ?? last.t; break; } }
  let marksAt = 0;
  for (let i = rows.length - 1; i > 0; i -= 1) { if (rows[i].marks !== rows[i - 1].marks) { marksAt = rows[i].t; break; } }
  let still = 0;
  for (let i = rows.length - 1; i > 0; i -= 1) { if (rows[i].pos !== rows[i - 1].pos) { still = rows[i].t; break; } }
  let blankAt = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) { if (rows[i].blank > 0) { blankAt = rows[i + 1]?.t ?? last.t; break; } }
  let maxGap = 0;
  for (let i = 1; i < rows.length; i += 1) maxGap = Math.max(maxGap, rows[i].t - rows[i - 1].t);
  return { still, sharp, afterStill: Math.max(0, sharp - still), final: Math.round(final * 100) / 100, marks: marksAt, blank: blankAt, onScreen: last.pages, marksShown: last.marks, frames: rows.length, maxGap };
}

async function wheel(cdp, at, dx, dy, { ctrl = false, steps, gapMs = 16 } = {}) {
  for (let i = 0; i < steps; i += 1) {
    const t = Date.now();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: dx, deltaY: dy, modifiers: ctrl ? 2 : 0 });
    const left = gapMs - (Date.now() - t);
    if (left > 0) await sleep(left);
  }
}

async function touchSwipe(cdp, at, dx, dy, moves) {
  const point = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(at.x, at.y) });
  for (let i = 1; i <= moves; i += 1) {
    const t = Date.now();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(at.x + (dx * i) / moves, at.y + (dy * i) / moves) });
    const left = 16 - (Date.now() - t);
    if (left > 0) await sleep(left);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const pinch = (cdp, at, scaleFactor) => cdp.send('Input.synthesizePinchGesture', { x: at.x, y: at.y, scaleFactor, relativeSpeed: 800, gestureSourceType: 'touch' });

// Each gesture: how to set up (not timed) and the gesture itself (timing
// starts when it returns).
const DESKTOP = {
  fling: { label: 'scroll fling, fit zoom', act: (c, at) => wheel(c, at, 0, 600, { steps: 25 }) },
  flingBack: { label: 'scroll fling back up', act: (c, at) => wheel(c, at, 0, -600, { steps: 25 }) },
  zoomIn: { label: 'zoom in fast to ~800%', act: (c, at) => wheel(c, at, 0, -100, { ctrl: true, steps: 22, gapMs: 30 }) },
  panDeep: { label: 'scroll-pan at ~800%', act: (c, at) => wheel(c, at, 300, 300, { steps: 20 }) },
  zoomMax: { label: 'zoom to max and push past', act: async (c, at) => { await wheel(c, at, 0, -100, { ctrl: true, steps: 30, gapMs: 30 }); await wheel(c, at, 0, -8, { ctrl: true, steps: 24 }); } },
  panMax: { label: 'scroll-pan at max', act: (c, at) => wheel(c, at, 400, 400, { steps: 20 }) },
  zoomOut: { label: 'zoom out past min', act: (c, at) => wheel(c, at, 0, 100, { ctrl: true, steps: 80, gapMs: 20 }) },
  zoomFit: { label: 'zoom back in from min', act: (c, at) => wheel(c, at, 0, -100, { ctrl: true, steps: 20, gapMs: 30 }) },
};
const PHONE_GESTURES = {
  fling: { label: 'swipe fling, fit zoom', act: (c, at) => touchSwipe(c, at, 0, -500, 6) },
  flingBack: { label: 'swipe fling back', act: (c, at) => touchSwipe(c, at, 0, 500, 6) },
  flingHard: { label: 'hard swipe fling, many sheets', act: (c, at) => touchSwipe(c, at, 0, -660, 6) },
  zoomIn: { label: 'pinch in to ~400%', act: async (c, at) => { await pinch(c, at, 2.2); await pinch(c, at, 2.0); } },
  panDeep: { label: 'swipe-pan at ~400%', act: (c, at) => touchSwipe(c, at, -250, -300, 8) },
  zoomMax: { label: 'pinch to max and past', act: async (c, at) => { for (let i = 0; i < 3; i += 1) await pinch(c, at, 2.2); await pinch(c, at, 1.8); } },
  panMax: { label: 'swipe-pan at max', act: (c, at) => touchSwipe(c, at, -250, -300, 8) },
  zoomOut: { label: 'pinch out past min', act: async (c, at) => { for (let i = 0; i < 6; i += 1) await pinch(c, at, 0.3); } },
  zoomFit: { label: 'pinch back in', act: async (c, at) => { await pinch(c, at, 3); await pinch(c, at, 2); } },
};

async function run(browser) {
  const context = await browser.newContext(PHONE ? { ...PHONE } : { viewport: { width: 1440, height: 900 } });
  if (PHONE && process.env.APP) {
    await context.addInitScript((platform) => {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: () => false, Plugins: {}, registerPlugin: () => new Proxy({}, { get: () => async () => ({}) }) };
    }, process.env.APP);
  }
  await context.route((u) => !['data:', 'blob:'].includes(u.protocol) && !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort('blockedbyclient'));
  await context.addInitScript(installProbe);
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await dialog.waitFor({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill('e2e-owner@example.com');
  await dialog.getByLabel('Password').fill('E2e-local-only-123!');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 60_000 });
  await page.getByText(DOC, { exact: true }).filter({ visible: true }).first().click();
  const openButton = page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
  if (!PHONE && await openButton.waitFor({ timeout: 8000 }).then(() => true, () => false)) await openButton.click();
  await page.waitForFunction(() => document.querySelectorAll('[data-overlay-page="1"] [data-annotation-index]').length > 0, null, { timeout: 120_000 });
  await sleep(2500);
  const cdp = await context.newCDPSession(page);
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const at = await page.evaluate(() => {
    const el = document.querySelector('[data-touch-pdf-surface]') || document.querySelector('.survey-pdfjs-page-div')?.parentElement?.parentElement;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.45) };
  });
  const gestures = PHONE ? PHONE_GESTURES : DESKTOP;
  const out = {};
  for (const [key, g] of Object.entries(gestures)) {
    if (ONLY && !ONLY.has(key)) continue;
    const trace = process.env.TRACE ? `${process.env.TRACE}-${key}.trace.json` : null;
    if (trace) await browser.startTracing(page, { path: trace, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu', 'viz'] });
    if (process.env.PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
    await g.act(cdp, at);
    await page.evaluate(() => window.__crisp.start());
    await sleep(WATCH_MS);
    const { rows, mounts } = await page.evaluate(() => { const r = window.__crisp.stop(); return { rows: [...r], mounts: r.mounts }; });
    if (trace) await browser.stopTracing();
    if (process.env.PROFILE) { const { profile } = await cdp.send('Profiler.stop'); fs.writeFileSync(`${process.env.PROFILE}-${key}.cpuprofile`, JSON.stringify(profile)); }
    out[key] = { what: g.label, ...summarise(rows), mounts };
    if (process.env.ROWS) out[key].rows = rows.filter((_, i) => i % 6 === 0).map((r) => `${r.t}:${Math.round(r.minRes * 100) / 100}/${r.marks}/${r.blank}`).join(' ');
    await sleep(800);
  }
  await context.close();
  return out;
}

// GPU=1 draws canvases on an emulated GPU (SwiftShader) off the page's
// thread, the way a real phone does; without it headless Chromium paints PDF
// pages in software on the page's own thread (seconds a sheet at CPU=4).
const browser = await chromium.launch({
  executablePath: exe,
  args: process.env.GPU ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-accelerated-2d-canvas'] : [],
});
for (let i = 0; i < RUNS; i += 1) {
  const out = await run(browser);
  for (const [k, v] of Object.entries(out)) console.log(k.padEnd(10), JSON.stringify(v));
}
await browser.close();
