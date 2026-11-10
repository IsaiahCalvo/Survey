#!/usr/bin/env node
// Scroll / zoom / pan smoothness on a big, heavily marked document (LOCAL e2e
// stack only). Seed first, e.g. the 36-sheet set and a 300-sheet set:
//
//   BIG_DOC_ID=e2eb1600-0000-4000-8000-000000000202 BIG_DOC_NAME="Package 2 Rev 4.pdf" \
//     BIG_DOC_PDF=debug/fixtures/package2-rev4.pdf BIG_DOC_HOT_PAGES=36 BIG_DOC_MARKUPS=5400 \
//     node scripts/perf/big-doc-seed.mjs
//   BIG_DOC_ID=e2eb1600-0000-4000-8000-000000000203 BIG_DOC_NAME="Big 300 Sheet Set.pdf" \
//     BIG_DOC_PAGES=300 BIG_DOC_MARKUPS=12000 node scripts/perf/big-doc-seed.mjs
//
// serve a build (vite build --mode e2e; vite preview --port 5241), then:
//
//   BASE=http://127.0.0.1:5241 BIG_DOC_NAME="Package 2 Rev 4.pdf" RUNS=2 node scripts/perf/scroll-frames.mjs
//
// Gestures (trusted input through CDP, one event per 16 ms like a 60 Hz mouse):
//   down / up   - wheel scroll through STEPS notches (100 px each) and back
//   flingDown / flingUp - fast wheel (FLING px a notch) through many pages and back
//   zoomIn / zoomOut - Ctrl+wheel, ZOOM_STEPS notches each way
//   pan         - drag the page with the default Hand tool while zoomed in
//   survey      - press Survey, then Escape (in and out of survey marking)
// Per gesture: rAF frame intervals (mean, p95, frames over 17.7 / 33 ms), long
// animation frames (total, longest, top scripts with LOAF=1), blankMs (frame
// time with a page in view still white: no raster yet), unmarkedMs (frame
// time with a page in view drawn but its marks not shown yet), and settleMs
// (after the last input, until every page in view has its raster and marks).
// PROFILE=<prefix> records a CPU profile per gesture of the first run.
// RENDERS=1 counts React commits and renders per component per gesture
// (name the components with an unminified build: --minify false).
// CPU=<n> slows the page n times (a slower laptop or tablet).
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:5241';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`refusing non-local BASE ${BASE}`);
const RUNS = Number(process.env.RUNS || 2);
const STEPS = Number(process.env.STEPS || 60);
const FLING = Number(process.env.FLING || 900);
const FLING_STEPS = Number(process.env.FLING_STEPS || 40);
const ZOOM_STEPS = Number(process.env.ZOOM_STEPS || 8);
const DOC_NAME = process.env.BIG_DOC_NAME || 'Package 2 Rev 4.pdf';
const GESTURES = (process.env.GESTURES || 'down,up,flingDown,flingUp,zoomIn,pan,zoomOut,survey').split(',');
const PROFILE = process.env.PROFILE || null;
const QUIET_MS = Number(process.env.QUIET_MS || 2500);
const exe = process.env.PW_CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitQuiet(page, quietMs = QUIET_MS) {
  await page.evaluate(() => {
    if (window.__quietObs) return;
    window.__lastLong = performance.now();
    window.__quietObs = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lastLong = Math.max(window.__lastLong, e.startTime + e.duration); });
    window.__quietObs.observe({ type: 'long-animation-frame' });
  });
  await page.waitForFunction((q) => performance.now() - window.__lastLong > q, quietMs, { timeout: 120_000, polling: 200 }).catch(() => {});
}

async function signInAndOpen(page) {
  await page.goto(`${BASE}/`);
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await dialog.waitFor({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill('e2e-owner@example.com');
  await dialog.getByLabel('Password').fill('E2e-local-only-123!');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 60_000 });
  await page.getByText(DOC_NAME, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('[data-overlay-page="1"] [data-annotation-index]').length > 0, null, { timeout: 120_000 });
  await waitQuiet(page);
}

// In the page: what the pages in view show right now.
function installViewProbe() {
  window.__viewState = () => {
    // Builds before the marks-layer hold never set the flag.
    if (window.__marksGate == null && document.querySelector('[data-marks-layer]')) window.__marksGate = true;
    const scroller = document.querySelector('.survey-pdfjs-page-div')?.closest('[data-pdfjs-scroller], .survey-pdfjs-scroller') || null;
    const vw = innerWidth; const vh = innerHeight;
    let blank = 0; let unmarked = 0; let inView = 0; let noRaster = 0; let noLayer = 0;
    for (const el of document.querySelectorAll('.survey-pdfjs-page-div[data-page-number]')) {
      if (el.style.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 60 || r.top > vh - 20 || r.right < 0 || r.left > vw) continue;
      // Ignore slivers (a few px of the next page at the bottom edge).
      const shown = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (shown < 40) continue;
      inView += 1;
      // White: no bitmap yet, or the drawing held for its marks layer
      // (styles/pageReveal.css: data-marks-layer).
      if (!el.hasAttribute('data-raster-shown')) { blank += 1; noRaster += 1; continue; }
      if (window.__marksGate && !el.hasAttribute('data-marks-layer')) { blank += 1; noLayer += 1; continue; }
      const n = Number(el.getAttribute('data-page-number'));
      const overlay = document.querySelector(`[data-overlay-page="${n}"]`);
      if (!overlay || !overlay.querySelector('[data-annotation-index]')) unmarked += 1;
    }
    return { inView, blank, unmarked, noRaster, noLayer, scroller: Boolean(scroller) };
  };
}

// A DevTools hook stub: per commit, walk only the subtrees React touched and
// count the components that did render work (the PerformedWork flag).
function installRenderCounter() {
  const nameOf = (f) => {
    const t = f.type;
    if (!t) return null;
    const inner = t.type || t.render || t;
    return t.displayName || f.elementType?.displayName || inner.displayName || inner.name || 'anonymous';
  };
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  const walk = (fiber, by) => {
    for (let f = fiber; f; f = f.sibling) {
      // A DOM element React reconciled with new props (a skipped one keeps them).
      if (f.tag === 5 && (!f.alternate || f.memoizedProps !== f.alternate.memoizedProps)) by['<host elements>'] = (by['<host elements>'] || 0) + 1;
      if (COMPONENT_TAGS.has(f.tag) && (f.flags & 1)) {
        const n = nameOf(f);
        by[n] = (by[n] || 0) + 1;
        // WHY=<Name>: which hook state or props changed for that component.
        if (window.__why === n && f.alternate) {
          const changed = [];
          let a = f.alternate.memoizedState; let b = f.memoizedState; let i = 0;
          const show = (v) => { try { const t = typeof v; if (v && t === 'object') return `${v.constructor?.name || 'obj'}${Array.isArray(v) ? `[${v.length}]` : v instanceof Map || v instanceof Set ? `(${v.size})` : `{${Object.keys(v).slice(0, 4).join(',')}}`}`; return `${t}:${String(v).slice(0, 30)}`; } catch { return '?'; } };
          while (a && b) {
            const isEffect = b.memoizedState && typeof b.memoizedState === 'object' && 'create' in b.memoizedState && 'deps' in b.memoizedState;
            if (!isEffect && a.memoizedState !== b.memoizedState && !(b.queue == null)) changed.push(`#${i}=${show(b.memoizedState)}`);
            a = a.next; b = b.next; i += 1;
          }
          if (f.memoizedProps !== f.alternate.memoizedProps) {
            const pa = f.alternate.memoizedProps || {}; const pb = f.memoizedProps || {};
            for (const k of Object.keys(pb)) if (pa[k] !== pb[k]) changed.push(`p.${k}`);
          }
          const key = changed.join(' ') || '(context/parent)';
          window.__whyLog[key] = (window.__whyLog[key] || 0) + 1;
        }
      }
      if (f.child && !(f.alternate && f.alternate.child === f.child)) walk(f.child, by);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      const rc = window.__renderCount;
      if (!rc || !rc.on) return;
      rc.commits += 1;
      walk(root.current.child, rc.by);
    },
  };
}

async function startSampling(page) {
  await page.evaluate(() => {
    if (window.__renderCount) { window.__renderCount.on = true; window.__renderCount.commits = 0; window.__renderCount.by = {}; }
    const s = { frames: [], loaf: [], blankMs: 0, unmarkedMs: 0, on: true, t0: performance.now(), lastInput: performance.now(), settledAt: null };
    window.__samp = s;
    let last = null;
    const tick = (t) => {
      if (!s.on) return;
      const v = window.__viewState();
      if (last != null) {
        const dt = t - last;
        s.frames.push(dt);
        if (v.blank) s.blankMs += dt;
        if (v.noRaster) s.noRasterMs = (s.noRasterMs || 0) + dt;
        if (v.noLayer) s.noLayerMs = (s.noLayerMs || 0) + dt;
        if (v.unmarked) s.unmarkedMs += dt;
      }
      if (!v.blank && !v.unmarked) { if (s.settledAt == null) s.settledAt = t; } else s.settledAt = null;
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    s.obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!s.on) continue;
        s.loaf.push({ at: e.startTime - s.t0, dur: e.duration, script: (e.scripts || []).reduce((a, x) => a + x.duration, 0), top: (e.scripts || []).sort((a, b) => b.duration - a.duration).slice(0, 2).map((x) => `${x.invoker || x.name}@${String(x.sourceURL || '').split('/').pop()}:${x.sourceFunctionName || ''}:${Math.round(x.duration)}`) });
      }
    });
    s.obs.observe({ type: 'long-animation-frame' });
  });
}

const markInputDone = (page) => page.evaluate(() => { window.__samp.lastInput = performance.now(); window.__samp.settledAt = null; });

async function stopSampling(page, { maxSettleMs = 8000 } = {}) {
  // Wait until the view has settled (all pages in view drawn + marked) or give up.
  await page.waitForFunction(() => window.__samp.settledAt != null && performance.now() - window.__samp.settledAt > 250, null, { timeout: maxSettleMs, polling: 50 }).catch(() => {});
  await sleep(300);
  return page.evaluate(() => {
    const s = window.__samp;
    s.on = false;
    s.obs.disconnect();
    const f = [...s.frames].sort((a, b) => a - b);
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    // NETLOG=1: PDF byte requests still running or recently finished.
    const net = window.__netlog ? performance.getEntriesByType('resource')
      .filter((e) => /storage|object|\.pdf/.test(e.name))
      .map((e) => `${Math.round(e.startTime - s.t0)}..${Math.round(e.responseEnd - s.t0)} ${Math.round((e.transferSize || e.encodedBodySize || 0) / 1024)}KB`)
      .slice(-12) : null;
    const qlog = globalThis.__rasterQueueLog ? globalThis.__rasterQueueLog.filter((q) => q[0] >= s.t0 - 1500).map((q) => `${q[0] - Math.round(s.t0)}:${q.slice(1).join('/')}`) : null;
    const workerLog = window.__workerLog ? window.__workerLog.filter((w) => w[0] >= s.t0 - 500).map((w) => `${w[0] - Math.round(s.t0)}:w${w[1]}:${w[2]}:${w[3]}${w[4] ? `:${w[4]}` : ''}`) : null;
    const out = {
      workerLog,
      qlog,
      net,
      frames: f.length,
      meanFrame: f.length ? sum(f) / f.length : 0,
      p95Frame: f.length ? f[Math.min(f.length - 1, Math.floor(f.length * 0.95))] : 0,
      overVsync: f.filter((x) => x > 17.7).length,
      over33: f.filter((x) => x > 33.4).length,
      loafMs: sum(s.loaf.map((l) => l.dur)),
      loafLongest: Math.max(0, ...s.loaf.map((l) => l.dur)),
      loafScriptMs: sum(s.loaf.map((l) => l.script)),
      blankMs: s.blankMs,
      noRasterMs: s.noRasterMs || 0,
      noLayerMs: s.noLayerMs || 0,
      unmarkedMs: s.unmarkedMs,
      settleMs: s.settledAt != null ? Math.max(0, s.settledAt - s.lastInput) : -1,
      view: window.__viewState(),
    };
    if (window.__renderCount) {
      window.__renderCount.on = false;
      out.commits = window.__renderCount.commits;
      if (window.__why) { out.why = Object.entries(window.__whyLog).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${v}x ${k}`); window.__whyLog = {}; }
      out.renders = Object.entries(window.__renderCount.by).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}:${v}`).join(' ');
    }
    if (window.__loafDetail) out.loaf = s.loaf.sort((a, b) => b.dur - a.dur).slice(0, 8).map((l) => `${Math.round(l.at)}+${Math.round(l.dur)} script=${Math.round(l.script)} ${l.top.join(' ')}`);
    return out;
  });
}

async function viewerCentre(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-touch-pdf-surface]');
    const r = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
}

async function wheel(cdp, at, dy, { ctrl = false, steps, gapMs = 16 } = {}) {
  for (let i = 0; i < steps; i += 1) {
    const t = Date.now();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: dy, modifiers: ctrl ? 2 : 0 });
    const left = gapMs - (Date.now() - t);
    if (left > 0) await sleep(left);
  }
}

// A point on a page with no mark under it (the Hand tool pans from there).
async function emptyPagePoint(page) {
  return page.evaluate(() => {
    const vw = innerWidth; const vh = innerHeight;
    for (let gy = 3; gy <= 7; gy += 1) {
      for (let gx = 3; gx <= 7; gx += 1) {
        const x = (vw * gx) / 10; const y = (vh * gy) / 10;
        const hit = document.elementFromPoint(x, y);
        if (hit?.closest?.('.survey-pdfjs-page-div') && !hit.closest('[data-annotation-index]')) return { x, y };
      }
    }
    return { x: vw / 2, y: vh / 2 };
  });
}

async function drag(cdp, from, dx, dy, moves = 60) {
  const send = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
  await send('mouseMoved', from.x, from.y, 0);
  await send('mousePressed', from.x, from.y, 1);
  for (let i = 1; i <= moves; i += 1) {
    const t = Date.now();
    await send('mouseMoved', from.x + (dx * i) / moves, from.y + (dy * i) / moves, 1);
    const left = 16 - (Date.now() - t);
    if (left > 0) await sleep(left);
  }
  await send('mouseReleased', from.x + dx, from.y + dy, 0);
}

async function gesture(page, cdp, name, profile) {
  const at = await viewerCentre(page);
  // TRACE=1 with PROFILE= records a Chrome trace (script / style / layout / paint) instead.
  const trace = profile && process.env.TRACE ? `${profile}-${name}.trace.json` : null;
  if (trace) await page.context().browser().startTracing(page, { path: trace, categories: process.env.SELECTORS ? ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-blink.debug'] : ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu', 'viz'] });
  else if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  await startSampling(page);
  const t0 = Date.now();
  if (name === 'down') await wheel(cdp, at, 100, { steps: STEPS });
  else if (name === 'up') await wheel(cdp, at, -100, { steps: STEPS });
  else if (name === 'flingDown') await wheel(cdp, at, FLING, { steps: FLING_STEPS });
  else if (name === 'flingUp') await wheel(cdp, at, -FLING, { steps: FLING_STEPS });
  else if (name === 'zoomIn') await wheel(cdp, at, -100, { ctrl: true, steps: ZOOM_STEPS, gapMs: 60 });
  else if (name === 'zoomOut') await wheel(cdp, at, 100, { ctrl: true, steps: ZOOM_STEPS, gapMs: 60 });
  else if (name === 'pan') {
    const from = await emptyPagePoint(page);
    await drag(cdp, from, -500, -300);
    await drag(cdp, await emptyPagePoint(page), 500, 300);
  } else if (name === 'survey') {
    const button = page.getByRole('button', { name: 'Survey', exact: true }).filter({ visible: true }).first();
    if (await button.isEnabled().catch(() => false)) {
      await button.click();
      await sleep(1200);
      await page.keyboard.press('Escape');
    }
  }
  const inputMs = Date.now() - t0;
  await markInputDone(page);
  const r = await stopSampling(page);
  r.inputMs = inputMs;
  if (trace) await page.context().browser().stopTracing();
  else if (profile) {
    const { profile: p } = await cdp.send('Profiler.stop');
    fs.writeFileSync(`${profile}-${name}.cpuprofile`, JSON.stringify(p));
  }
  return r;
}

async function oneRun(browser, run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Never let the harness reach a real host.
  await context.route((u) => !['data:', 'blob:'].includes(u.protocol) && !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort('blockedbyclient'));
  await context.addInitScript(installViewProbe);
  if (process.env.RENDERS) {
    await context.addInitScript(installRenderCounter);
    await context.addInitScript((why) => { window.__renderCount = { on: false, commits: 0, by: {} }; window.__why = why; window.__whyLog = {}; }, process.env.WHY || null);
  }
  // WORKERLOG=1: what the page asks its pdf.js workers for during each gesture.
  if (process.env.WORKERLOG) {
    await context.addInitScript(() => {
      window.__workerLog = [];
      const post = Worker.prototype.postMessage;
      let ids = 0;
      const workerIds = new WeakMap();
      Worker.prototype.postMessage = function (msg, ...rest) {
        try {
          if (!workerIds.has(this)) workerIds.set(this, ++ids);
          if (msg && msg.action && window.__workerLog.length < 4000) {
            window.__workerLog.push([Math.round(performance.now()), workerIds.get(this), msg.action, msg.data?.pageIndex ?? msg.data?.pageId ?? '', msg.data?.intent ?? '']);
          }
        } catch { /* keep the post */ }
        return post.call(this, msg, ...rest);
      };
    });
  }
  if (process.env.QLOG) await context.addInitScript(() => { globalThis.__rasterQueueLog = []; });
  if (process.env.NETLOG) await context.addInitScript(() => { window.__netlog = true; });
  if (process.env.LOAF) await context.addInitScript(() => { window.__loafDetail = true; });
  const page = await context.newPage();
  await signInAndOpen(page);
  // SETTLE_MS=<ms>: wait this long after the open before the gestures (lets
  // background work such as the search text read-ahead finish).
  if (process.env.SETTLE_MS) await sleep(Number(process.env.SETTLE_MS));
  const cdp = await context.newCDPSession(page);
  if (process.env.CPU) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU) });
  // DROP_RULES=<regex>: delete matching CSS rules first (which rules cost the scroll).
  if (process.env.DROP_RULES) {
    const dropped = await page.evaluate((src) => {
      const re = new RegExp(src);
      let n = 0;
      const walk = (list) => {
        for (let i = list.cssRules.length - 1; i >= 0; i -= 1) {
          const rule = list.cssRules[i];
          if (rule.cssRules && !rule.selectorText) { walk(rule); continue; }
          if (rule.selectorText && re.test(rule.selectorText)) { list.deleteRule(i); n += 1; }
        }
      };
      for (const sheet of document.styleSheets) { try { walk(sheet); } catch { /* cross-origin */ } }
      return n;
    }, process.env.DROP_RULES);
    console.log('dropped rules', dropped);
  }
  const out = {};
  for (const name of GESTURES) {
    out[name] = await gesture(page, cdp, name, PROFILE && run === 0 ? PROFILE : null);
    await waitQuiet(page, 1200);
  }
  if (process.env.VSLOG) console.log('vslog', JSON.stringify(await page.evaluate(() => window.__vsLog || [])));
  out.heapMB = (await page.evaluate(() => performance.memory?.usedJSHeapSize || 0)) / 1e6;
  await context.close();
  return out;
}

const fmt = (r) => `frames ${r.frames} mean ${r.meanFrame.toFixed(1)} p95 ${r.p95Frame.toFixed(1)} >17 ${r.overVsync} >33 ${r.over33} | loaf ${Math.round(r.loafMs)} longest ${Math.round(r.loafLongest)} | blank ${Math.round(r.blankMs)} (raster ${Math.round(r.noRasterMs)} layer ${Math.round(r.noLayerMs)}) unmarked ${Math.round(r.unmarkedMs)} settle ${Math.round(r.settleMs)} | input ${r.inputMs}`;

const browser = await chromium.launch({ executablePath: exe, args: ['--enable-precise-memory-info'] });
const runs = [];
for (let run = 0; run < RUNS; run += 1) {
  const r = await oneRun(browser, run);
  runs.push(r);
  console.log(`run ${run + 1} (${DOC_NAME}) heap ${r.heapMB.toFixed(0)} MB`);
  for (const name of GESTURES) {
    console.log(`  ${name.padEnd(10)} ${fmt(r[name])}`);
    if (r[name].renders) console.log(`      commits ${r[name].commits}: ${r[name].renders}`);
    if (r[name].qlog) console.log(`      queue ${r[name].qlog.join(' ')}`);
    if (r[name].workerLog) console.log(`      worker ${r[name].workerLog.join(' ')}`);
    if (r[name].net) console.log(`      net ${r[name].net.join(' | ')}`);
    if (r[name].why) for (const w of r[name].why) console.log(`      why ${w}`);
    if (r[name].loaf) for (const l of r[name].loaf) console.log(`      ${l}`);
  }
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const medians = {};
for (const name of GESTURES) {
  medians[name] = {};
  for (const k of ['over33', 'overVsync', 'loafMs', 'loafLongest', 'blankMs', 'unmarkedMs', 'settleMs']) medians[name][k] = Math.round(med(runs.map((r) => r[name][k])));
}
console.log('MEDIANS', JSON.stringify(medians));
await browser.close();
