#!/usr/bin/env node
// Zoom / scroll smoothness at every zoom level — a rerunnable measurement.
//
//   npx vite --port 5617 --strictPort &
//   node debug/scenarios/zoom-perf.mjs --base http://127.0.0.1:5617 --device phone
//
// --device  phone   Chromium 390x844, touch, iPhone UA, CPU 4x slower (CDP)
//           webkit  WebKit 393x852, touch (no CPU throttle available)
//           desktop Chromium 1440x900, mouse, CPU 2x slower (CDP)
// --docs    comma list of keys from DOCS below (default: all)
// --levels  comma list: min,0.1,0.25,0.5,fit,1,2,4,max (default: all)
// --gestures comma list: pinch,fling,wheel (default: pinch,fling on touch, wheel,fling on desktop)
// --json    write every number to this file as well
// --trace   level:gesture (e.g. fit:fling) — save a Chromium trace of that run
//           to --trace-out (default ./zoom-perf-trace.json)
// --chromium / --webkit  browser executable overrides (PW_CHROMIUM_PATH / PW_WEBKIT_PATH)
//
// For each document and zoom level it prints, per gesture:
//   move p50 / p95 / max  frame times (ms) while the page is moving (fingers,
//                         then any glide or bounce), and frames dropped then
//                         (each frame past 16.7 ms counts its missed vsyncs)
//   after                 the longest frame after it stopped, until sharp
//   long                  tasks over 50 ms (Chromium) in the whole run
//   blank                 sampled frames showing a page on screen still blank
//   sharp                 ms after the page stops until every page on screen
//                         is drawn at full sharpness
// Before the gesture it records mounted pages, canvas count and canvas
// megapixels, annotation SVG nodes and the JS heap. The page's own dev hook
// (window.__pdfjsViewerPerf, DEV builds only) sets the exact zoom.
import { chromium, webkit } from 'playwright';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const BASE = args.base || process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';
const DEVICE = args.device || 'phone';
const TOUCH = DEVICE !== 'desktop';
const DOCS = {
  p120: { pdf: 'spike-120-pages.pdf', label: '120 pages' },
  pkg2: { pdf: 'Package 2 - Rev 4 -- IC.pdf', label: 'Package 2 (big sheets, marks)' },
  links: { pdf: 'clickable-link-test.pdf', label: 'clickable-link-test' },
};
const docKeys = (args.docs || Object.keys(DOCS).join(',')).split(',');
const LEVELS = (args.levels || 'min,0.1,0.25,0.5,fit,1,2,4,max').split(',');
const GESTURES = (args.gestures || (TOUCH ? 'pinch,fling' : 'wheel,fling')).split(',');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- in-page recorder (installed before the app loads) ----------------------
function installRecorder() {
  const R = { on: false, frames: [], long: [], blankSamples: 0, samples: 0 };
  window.__zp = R;
  try {
    new PerformanceObserver((list) => {
      if (!R.on) return;
      for (const e of list.getEntries()) R.long.push(e.duration);
    }).observe({ type: 'longtask', buffered: false });
  } catch { /* WebKit: no longtask entries; frame gaps still show them */ }
  // Which pages on screen are blank / how sharp each one is. Reads layout, so
  // the frame loop calls it only every few frames.
  R.pageState = () => {
    const sc = document.querySelector('.survey-pdfjs-viewer, [data-mobile-pdf-surface]');
    if (!sc) return { visible: 0, blank: 0, soft: 0 };
    const vr = sc.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let visible = 0; let blank = 0; let soft = 0;
    for (const pd of sc.querySelectorAll('.survey-pdfjs-page-div')) {
      const r = pd.getBoundingClientRect();
      if (r.bottom < vr.top || r.top > vr.bottom || r.right < vr.left || r.left > vr.right || r.width < 1) continue;
      visible += 1;
      const cs = [...pd.querySelectorAll(':scope > canvas, :scope > div > canvas')];
      const base = cs[0];
      if (!base || (base.width === 300 && base.height === 150) || base.width === 0) { blank += 1; continue; }
      let best = base.width / (r.width * dpr);
      for (const t of cs.slice(1)) {
        if (t.style.display === 'none' || !t.width) continue;
        const tr = t.getBoundingClientRect();
        if (tr.width > 0) best = Math.max(best, t.width / (tr.width * dpr));
      }
      if (best < 0.85) soft += 1;
    }
    return { visible, blank, soft };
  };
  let lastPos = '';
  const loop = (t) => {
    if (R.on) {
      // Is the page moving this frame? (scroll position or the live
      // zoom/bounce transform changed)
      const sc = document.querySelector('[data-mobile-pdf-surface="true"]') || document.querySelector('.survey-pdfjs-viewer');
      const content = sc?.querySelector('[data-pdfjs-content="true"]');
      const pos = sc ? `${sc.scrollTop}|${sc.scrollLeft}|${content?.style.transform || ''}` : '';
      if (pos !== lastPos) R.lastMoveAt = t;
      lastPos = pos;
      R.frames.push(t);
      if (R.frames.length % 4 === 0) {
        const s = R.pageState();
        R.samples += 1;
        if (s.blank) R.blankSamples += 1;
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  R.start = () => { R.frames = []; R.long = []; R.blankSamples = 0; R.samples = 0; R.lastMoveAt = performance.now(); R.on = true; };
  R.inputEnded = () => { R.inputEndAt = performance.now(); };
  R.stop = () => { R.on = false; return { frames: R.frames, long: R.long, blankSamples: R.blankSamples, samples: R.samples, moveEnd: Math.max(R.lastMoveAt || 0, R.inputEndAt || 0) }; };
  // Resolves once the page has not moved for `quiet` ms.
  R.untilStill = (quiet = 150, limit = 5000) => new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const now = performance.now();
      if (now - (R.lastMoveAt || 0) > quiet || now - t0 > limit) { resolve(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // Resolves with ms from now until every page on screen is drawn and sharp
  // (checked each frame), or null after `limit` ms.
  R.untilSharp = (limit = 10000) => new Promise((resolve) => {
    const t0 = performance.now();
    let okSince = null;
    const tick = () => {
      const s = R.pageState();
      const now = performance.now();
      if (s.blank === 0 && s.soft === 0) {
        if (okSince == null) okSince = now;
        // Must hold for 3 frames (a raster that lands then is replaced is not "done").
        if (now - okSince > 48) { resolve(Math.round(okSince - t0)); return; }
      } else okSince = null;
      if (now - t0 > limit) { resolve(null); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // Synthetic touch for WebKit (no CDP): the viewer's own listeners read
  // touches[i].clientX/Y, target, preventDefault and stopPropagation.
  R.touch = (type, pts) => {
    const sc = document.querySelector('[data-mobile-pdf-surface="true"]');
    // A real touch keeps the target it started on; a touchend has no points,
    // so it goes to that same target (elementFromPoint(1, 1) was the app
    // header, outside the viewer: the pinch never ended).
    const target = type === 'touchstart' || !R.touchTarget?.isConnected
      ? (document.elementFromPoint(pts[0]?.x ?? 1, pts[0]?.y ?? 1) || sc)
      : R.touchTarget;
    R.touchTarget = target;
    const list = pts.map((p, i) => ({ identifier: i + 1, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y, screenX: p.x, screenY: p.y, target }));
    const ev = new Event(type, { bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : list });
    Object.defineProperty(ev, 'targetTouches', { value: type === 'touchend' ? [] : list });
    Object.defineProperty(ev, 'changedTouches', { value: list });
    target.dispatchEvent(ev);
  };
}

function stats(frames, until = Infinity) {
  const d = [];
  for (let i = 1; i < frames.length && frames[i - 1] <= until; i += 1) d.push(frames[i] - frames[i - 1]);
  if (!d.length) return { p50: null, p95: null, max: null, dropped: 0, n: 0 };
  const s = [...d].sort((a, b) => a - b);
  const q = (k) => s[Math.min(s.length - 1, Math.floor(k * (s.length - 1)))];
  const dropped = d.reduce((n, x) => n + Math.max(0, Math.round(x / 16.67) - 1), 0);
  return { p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s.at(-1).toFixed(1), dropped, n: d.length };
}

async function launch() {
  if (DEVICE === 'webkit') {
    const b = await webkit.launch({ executablePath: args.webkit || process.env.PW_WEBKIT_PATH || undefined });
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA });
    return { b, ctx };
  }
  const b = await chromium.launch({ executablePath: args.chromium || process.env.PW_CHROMIUM_PATH || undefined });
  const ctx = DEVICE === 'phone'
    ? await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: UA })
    : await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  return { b, ctx };
}

async function openDoc(ctx, doc) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  PAGEERR', e.message.slice(0, 200)));
  const q = `?testPdf=${encodeURIComponent(doc.pdf)}${TOUCH ? '&mobileNav=tabs&nativeShell=expo' : '&surveyTemplateWorkflowE2E=1'}${doc.extra || ''}`;
  await page.goto(`${BASE}/${q}`, { waitUntil: 'load' });
  const ready = () => page.waitForFunction(() => window.__pdfjsViewerPerf && document.querySelector('[data-page-number="1"] canvas'), null, { timeout: 90000 });
  // A cold Vite server may re-optimise dependencies and drop the first load.
  try { await ready(); } catch { await page.reload({ waitUntil: 'load' }); await ready(); }
  await sleep(4000);
  let cdp = null;
  if (DEVICE !== 'webkit') {
    cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: DEVICE === 'phone' ? 4 : 2 });
  }
  return { page, cdp };
}

const viewerBox = (page) => page.evaluate(() => {
  const sc = document.querySelector('[data-mobile-pdf-surface="true"]') || document.querySelector('.survey-pdfjs-viewer');
  const r = sc.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});

async function setLevel(page, level) {
  return page.evaluate(async (level) => {
    const api = window.__pdfjsViewerPerf;
    const min = api.getMinimumScale();
    const max = api.getMaximumScale();
    let target = level;
    if (level === 'min') target = min;
    else if (level === 'max') target = max;
    else if (level !== 'fit') target = Number(level);
    if (typeof target === 'number' && (target < min - 1e-6 || target > max + 1e-6)) return { skipped: true, min, max };
    api.zoomTo(target);
    await new Promise((r) => setTimeout(r, 300));
    // Middle of the document in view (the most pages around it).
    const n = document.querySelectorAll('.survey-pdfjs-page-div').length;
    const mid = Math.min(n, Math.max(1, Math.round(n / 3)));
    const sc = document.querySelector('[data-mobile-pdf-surface="true"]') || document.querySelector('.survey-pdfjs-viewer');
    const pd = sc.querySelector(`.survey-pdfjs-page-div[data-page-number="${mid}"]`);
    if (pd) {
      const pr = pd.getBoundingClientRect(); const sr = sc.getBoundingClientRect();
      sc.scrollTop += (pr.top + pr.height / 2) - (sr.top + sr.height / 2);
      sc.scrollLeft += (pr.left + pr.width / 2) - (sr.left + sr.width / 2);
    }
    return { scale: api.getScale(), min, max };
  }, level);
}

const snapshot = (page) => page.evaluate(() => {
  const sc = document.querySelector('[data-mobile-pdf-surface="true"]') || document.querySelector('.survey-pdfjs-viewer');
  const canv = [...sc.querySelectorAll('canvas')];
  const st = window.__zp.pageState();
  return {
    mounted: sc.querySelectorAll('[data-page-mounted="true"]').length,
    visible: st.visible,
    canvases: canv.length,
    canvasMP: +(canv.reduce((s, c) => s + c.width * c.height, 0) / 1e6).toFixed(1),
    svgNodes: sc.querySelectorAll('[data-pdfjs-page-overlay-host] svg *').length,
    textSpans: sc.querySelectorAll('.textLayer span, .pdfjsTextLayer span').length,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
});

async function runGesture(page, cdp, name, box, level) {
  const cx = box.x + box.w / 2; const cy = box.y + box.h / 2;
  const tracing = Boolean(cdp && args.trace === `${level}:${name}`);
  const traceEvents = [];
  if (tracing) {
    cdp.on('Tracing.dataCollected', (d) => traceEvents.push(...d.value));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink,cc,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
  }
  await page.evaluate(() => window.__zp.start());
  const t0 = Date.now();
  const touch = async (type, pts) => {
    if (cdp) {
      const cdpType = { touchstart: 'touchStart', touchmove: 'touchMove', touchend: 'touchEnd' }[type];
      await cdp.send('Input.dispatchTouchEvent', { type: cdpType, touchPoints: type === 'touchend' ? [] : pts.map((p, i) => ({ id: i + 1, x: p.x, y: p.y, radiusX: 5, radiusY: 5, force: 0.7 })) });
    } else {
      await page.evaluate(({ type, pts }) => window.__zp.touch(type, pts), { type, pts });
    }
  };
  if (name === 'pinch') {
    // In then out (out then in at max), one continuous two-finger gesture.
    const k = level === 'max' ? 1 / 1.7 : 1.7;
    const d0 = 140; const steps = 24;
    const pts = (d) => [{ x: cx - d / 2, y: cy }, { x: cx + d / 2, y: cy }];
    await touch('touchstart', pts(d0));
    for (let i = 1; i <= steps * 2; i += 1) {
      const f = i <= steps ? i / steps : 2 - i / steps;
      await touch('touchmove', pts(d0 * (1 + (k - 1) * f)));
      await sleep(16);
    }
    await touch('touchend', []);
  } else if (name === 'fling') {
    if (TOUCH) {
      await touch('touchstart', [{ x: cx, y: cy + 200 }]);
      for (let i = 1; i <= 6; i += 1) { await touch('touchmove', [{ x: cx, y: cy + 200 - i * 70 }]); await sleep(8); }
      await touch('touchend', []);
    } else {
      await page.mouse.move(cx, cy);
      for (let i = 0; i < 24; i += 1) { await page.mouse.wheel(0, 160); await sleep(16); }
    }
  } else if (name === 'wheel') {
    await page.mouse.move(cx, cy);
    await page.keyboard.down('Control');
    const dir = level === 'max' ? 1 : -1;
    for (let i = 0; i < 14; i += 1) { await page.mouse.wheel(0, dir * 40); await sleep(16); }
    for (let i = 0; i < 14; i += 1) { await page.mouse.wheel(0, -dir * 40); await sleep(16); }
    await page.keyboard.up('Control');
  }
  await page.evaluate(() => window.__zp.inputEnded());
  const gestureMs = Date.now() - t0;
  await page.evaluate(() => window.__zp.untilStill());
  const sharpMs = await page.evaluate(() => window.__zp.untilSharp(12000));
  const rec = await page.evaluate(() => window.__zp.stop());
  if (tracing) {
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.end'); await done;
    fs.writeFileSync(args['trace-out'] || 'zoom-perf-trace.json', JSON.stringify({ traceEvents }));
  }
  const s = stats(rec.frames, rec.moveEnd);
  const after = rec.frames.filter((t) => t > rec.moveEnd);
  let afterMax = 0;
  for (let i = 1; i < after.length; i += 1) afterMax = Math.max(afterMax, after[i] - after[i - 1]);
  return {
    ...s,
    afterMax: +afterMax.toFixed(1),
    long: rec.long.filter((x) => x > 50).length,
    longMax: rec.long.length ? Math.round(Math.max(...rec.long)) : 0,
    blankFrames: rec.blankSamples,
    sampled: rec.samples,
    gestureMs,
    sharpMs,
  };
}

const results = { device: DEVICE, base: BASE, at: new Date().toISOString(), docs: {} };
const { b, ctx } = await launch();
await ctx.addInitScript(installRecorder);
for (const key of docKeys) {
  const doc = DOCS[key];
  if (!doc) { console.log(`unknown doc ${key}`); continue; }
  console.log(`\n== ${DEVICE} · ${doc.label}`);
  console.log('level   scale  | mount vis canv  MP  svg   heap | gesture  move: p50  p95   max drop | after  long blank sharp');
  const { page, cdp } = await openDoc(ctx, doc);
  const box = await viewerBox(page);
  results.docs[key] = {};
  for (const level of LEVELS) {
    const lv = await setLevel(page, level);
    if (lv.skipped) { console.log(`${level.padEnd(6)}  (outside ${lv.min.toFixed(3)}..${lv.max})`); continue; }
    // Settle: let the page draw before measuring the gesture.
    await page.evaluate(() => window.__zp.untilSharp(15000));
    await sleep(400);
    const snap = await snapshot(page);
    const row = { scale: lv.scale, ...snap, gestures: {} };
    for (const g of GESTURES) {
      row.gestures[g] = await runGesture(page, cdp, g, box, level);
      await sleep(500);
      // Put the view back where the gesture found it (a fling moves on).
      await setLevel(page, level);
      await page.evaluate(() => window.__zp.untilSharp(15000));
    }
    results.docs[key][level] = row;
    const head = `${level.padEnd(6)} ${(lv.scale * 100).toFixed(1).padStart(6)}% | ${String(snap.mounted).padStart(4)} ${String(snap.visible).padStart(3)} ${String(snap.canvases).padStart(4)} ${String(snap.canvasMP).padStart(4)} ${String(snap.svgNodes).padStart(5)} ${String(snap.heapMB ?? '-').padStart(5)}`;
    GESTURES.forEach((g, i) => {
      const r = row.gestures[g];
      console.log(`${i === 0 ? head : ' '.repeat(head.length)} | ${g.padEnd(6)}       ${String(r.p50).padStart(5)} ${String(r.p95).padStart(5)} ${String(r.max).padStart(5)} ${String(r.dropped).padStart(4)} | ${String(r.afterMax).padStart(5)} ${String(r.long).padStart(4)} ${String(r.blankFrames).padStart(5)} ${String(r.sharpMs ?? '>12s').padStart(5)}`);
    });
  }
  await page.close();
}
await b.close();
if (args.json) fs.writeFileSync(args.json, JSON.stringify(results, null, 1));
