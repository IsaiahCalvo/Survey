#!/usr/bin/env node
// Drag smoothness on the LOCAL e2e stack: frame times while moving one selected
// mark, moving a multi-selection, and resizing one mark. Seed first
// (node scripts/perf/big-doc-seed.mjs; BIG_DOC_HOT_PAGES=30 BIG_DOC_MARKUPS=20000
// for ~670 marks per sheet), serve a build (see big-doc-open.mjs), then:
//
//   BASE=http://127.0.0.1:5241 RUNS=3 node scripts/perf/drag-frames.mjs
//
// Each run is a cold context: sign in, open the doc, wait for page 1's marks
// and a quiet main thread, then three gestures of MOVES pointer moves, one
// every 16 ms (a 60 Hz mouse), sent through CDP so they are trusted input:
//   toolSwitch - the 1.8 s after pressing V (Select), before any gesture
//   move   - select one mark (Select tool) and drag it
//   multi  - shift-click MULTI marks and drag one of them
//   resize - drag the selected mark's bottom-right (or right) handle
// Per gesture: rAF frame intervals (mean, p95, frames over 33 ms), long
// animation frames (count, total, script time) and the wall time the moves
// took to be acknowledged. Every gesture is undone (Ctrl+Z) afterwards. Also
// the JS heap after a forced GC once the doc is open and after the switch.
// PROFILE=<file> records a CPU profile of each gesture of the first run.
// CPU=<n> slows the page n times once it is open (a slower laptop or tablet).
// PAINT=1 lists, per gesture, 2D canvas draw calls and canvas context, size
// and export calls (with the calling code) per canvas.
// DROP=1 also reports the long frames in the 1.5 s after the mouse is released
// (dropLoafMs / dropScriptMs / dropOver33) and all main-thread task time then
// (dropTaskMs): the cost of saving the edit.
// RENDERS=1 counts React commits during the moves and, per component, how many
// times it rendered (a stub DevTools hook; name the components with an
// unminified build: `vite build --mode e2e --minify false`), plus how many DOM
// elements React reconciled with new props ('<host elements>').
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:5241';
const RUNS = Number(process.env.RUNS || 3);
const MOVES = Number(process.env.MOVES || 60);
const MULTI = Number(process.env.MULTI || 6);
const QUIET_MS = Number(process.env.QUIET_MS || 2500);
const DOC_NAME = process.env.BIG_DOC_NAME || 'Big Drawing Set.pdf';
const GESTURES = (process.env.GESTURES || 'move,multi,resize').split(',');
const PROFILE = process.env.PROFILE || null;
const exe = process.env.PW_CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  // Wait for a quiet main thread (no long frame for QUIET_MS).
  await page.evaluate(() => {
    window.__lastLong = performance.now();
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lastLong = Math.max(window.__lastLong, e.startTime + e.duration); })
      .observe({ type: 'long-animation-frame' });
  });
  await page.waitForFunction((q) => performance.now() - window.__lastLong > q, QUIET_MS, { timeout: 120_000, polling: 200 });
}

// Screen-space grab points of marks on page 1 that sit fully in view: a point
// inside the mark's box where the browser's hit test lands on that mark (ink
// and outlines are hit on their stroke, so the box centre often misses).
async function markTargets(page, count) {
  return page.evaluate((n) => {
    const vw = innerWidth; const vh = innerHeight;
    const out = [];
    for (const el of document.querySelectorAll('[data-overlay-page="1"] g[data-annotation-index]')) {
      const index = el.getAttribute('data-annotation-index');
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.left < 150 || r.right > vw - 120 || r.top < 130 || r.bottom > vh - 140) continue;
      if (out.some((o) => o.box.left < r.right + 8 && r.left < o.box.right + 8 && o.box.top < r.bottom + 8 && r.top < o.box.bottom + 8)) continue;
      let point = null;
      for (let gy = 0; gy <= 8 && !point; gy += 1) {
        for (let gx = 1; gx <= 9 && !point; gx += 1) {
          const x = r.left + (r.width * gx) / 10;
          const y = r.top + (r.height * gy) / 8;
          const hit = document.elementFromPoint(x, y)?.closest?.('g[data-annotation-index]');
          if (hit && hit.getAttribute('data-annotation-index') === index && hit.closest('[data-overlay-page="1"]')) point = { x, y };
        }
      }
      if (!point) continue;
      out.push({ index, ...point, box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } });
      if (out.length >= n) break;
    }
    return out;
  }, count);
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
    const s = { frames: [], loaf: [], on: true, t0: performance.now() };
    window.__drag = s;
    let last = null;
    const tick = (t) => {
      if (!s.on) return;
      if (last != null) s.frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    s.obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!s.on) continue;
        s.loaf.push({ at: e.startTime - s.t0, dur: e.duration, script: (e.scripts || []).reduce((a, x) => a + x.duration, 0), render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0, top: (e.scripts || []).sort((a, b) => b.duration - a.duration).slice(0, 2).map((x) => `${x.invoker || x.name}@${String(x.sourceURL || '').split('/').pop()}:${x.sourceFunctionName || ''}:${Math.round(x.duration)}`) });
      }
    });
    s.obs.observe({ type: 'long-animation-frame' });
  });
}

async function stopSampling(page) {
  await sleep(120);
  return page.evaluate(() => {
    const s = window.__drag;
    s.on = false;
    s.obs.disconnect();
    const f = [...s.frames].sort((a, b) => a - b);
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    return {
      frames: f.length,
      meanFrame: f.length ? sum(f) / f.length : 0,
      p95Frame: f.length ? f[Math.min(f.length - 1, Math.floor(f.length * 0.95))] : 0,
      // A missed vsync: 16.7 ms plus 1 ms of timer jitter.
      overVsync: f.filter((x) => x > 17.7).length,
      over33: f.filter((x) => x > 33.4).length,
      loafCount: s.loaf.length,
      loafMs: sum(s.loaf.map((l) => l.dur)),
      loafScriptMs: sum(s.loaf.map((l) => l.script)),
      ...(window.__loafDetail ? { loaf: s.loaf.map((l) => `${Math.round(l.at)}+${Math.round(l.dur)} script=${Math.round(l.script)} render=${Math.round(l.render)} ${l.top.join(' ')}`) } : {}),
    };
  });
}

async function drag(page, cdp, from, dx, dy, { shift = false, profile = null, watch = null } = {}) {
  const leftOf = () => (watch == null ? 0 : page.evaluate((i) => document.querySelector(`[data-overlay-page="1"] g[data-annotation-index="${i}"]`)?.getBoundingClientRect().left ?? 0, watch));
  const before = await leftOf();
  const send = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, modifiers: shift ? 8 : 0 });
  await send('mouseMoved', from.x, from.y, 0);
  // TRACE=1 with PROFILE= records a Chrome trace (script / style / layout / paint / raster) instead.
  const trace = profile && process.env.TRACE ? profile.replace(/\.cpuprofile$/, '.trace.json') : null;
  if (trace) await page.context().browser().startTracing(page, { path: trace, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu', 'viz'] });
  else if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  if (process.env.PAINT) await page.evaluate(() => { window.__paint?.clear(); window.__paintOn = true; });
  await send('mousePressed', from.x, from.y, 1);
  await startSampling(page);
  // MUTATIONS=1: count what the DOM changes during the moves (which nodes a frame repaints).
  if (process.env.MUTATIONS) {
    await page.evaluate(() => {
      const counts = new Map();
      const describe = (n) => {
        const el = n.nodeType === 1 ? n : n.parentElement;
        if (!el) return '?';
        const attrs = [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name).slice(0, 2).join(',');
        const owner = el.closest('[data-svg-annotation-lift]') ? 'lift' : el.closest('[data-svg-annotation-layer]') ? 'layer' : 'html';
        return `${owner} ${el.tagName.toLowerCase()}[${attrs}]`;
      };
      window.__mutations = counts;
      window.__mo = new MutationObserver((list) => {
        for (const m of list) {
          const k = `${m.type}${m.attributeName ? `:${m.attributeName}` : ''} ${describe(m.target)}`;
          counts.set(k, (counts.get(k) || 0) + 1);
        }
      });
      window.__mo.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
    });
  }
  if (process.env.RENDERS) await page.evaluate(() => { window.__renderCount = { on: true, commits: 0, by: {} }; });
  // Main-thread time the moves cost (CDP Performance metrics, all frames).
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const m0 = await metrics();
  const t0 = Date.now();
  for (let i = 1; i <= MOVES; i += 1) {
    const tick = Date.now();
    await send('mouseMoved', from.x + (dx * i) / MOVES, from.y + (dy * i) / MOVES, 1);
    const spent = Date.now() - tick;
    if (spent < 16) await sleep(16 - spent);
  }
  const wall = Date.now() - t0;
  const stats = await stopSampling(page);
  const m1 = await metrics();
  const delta = (k) => (m1[k] - m0[k]) * 1000;
  Object.assign(stats, { taskMs: delta('TaskDuration'), scriptMs: delta('ScriptDuration'), styleMs: delta('RecalcStyleDuration'), layoutMs: delta('LayoutDuration') });
  if (process.env.RENDERS) {
    const rc = await page.evaluate(() => { const r = window.__renderCount; r.on = false; return { commits: r.commits, by: r.by }; });
    stats.commits = rc.commits;
    stats.hostElements = rc.by['<host elements>'] || 0;
    stats.renders = Object.entries(rc.by).reduce((a, [k, v]) => (k === '<host elements>' ? a : a + v), 0);
    stats.topRenders = Object.entries(rc.by).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v} ${k}`);
  }
  if (process.env.MUTATIONS) {
    stats.mutations = await page.evaluate(() => { window.__mo.disconnect(); return [...window.__mutations].sort((x, y) => y[1] - x[1]).slice(0, 15).map(([k, v]) => `${v} ${k}`); });
  }
  stats.watchedMovedPx = (await leftOf()) - before;
  if (process.env.PAINT) {
    stats.paint = await page.evaluate(() => { window.__paintOn = false; return [...window.__paint].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${v} ${k}`); });
  }
  if (trace) await page.context().browser().stopTracing();
  else if (profile) { const { profile: cpu } = await cdp.send('Profiler.stop'); fs.writeFileSync(profile, JSON.stringify(cpu)); }
  const dropProfile = profile && !trace && process.env.DROP ? profile.replace(/\.cpuprofile$/, '-drop.cpuprofile') : null;
  if (dropProfile) await cdp.send('Profiler.start');
  const m2 = process.env.DROP ? await metrics() : null;
  await send('mouseReleased', from.x + dx, from.y + dy, 0);
  if (process.env.DROP) {
    // DROP=1: what the drop itself costs (the edit is saved into the marks).
    await startSampling(page);
    await sleep(1500);
    const after = await stopSampling(page);
    const m3 = await metrics();
    stats.dropTaskMs = (m3.TaskDuration - m2.TaskDuration) * 1000;
    if (dropProfile) { const { profile: cpu } = await cdp.send('Profiler.stop'); fs.writeFileSync(dropProfile, JSON.stringify(cpu)); }
    stats.dropLoafMs = after.loafMs;
    stats.dropScriptMs = after.loafScriptMs;
    stats.dropOver33 = after.over33;
  }
  return { ...stats, wall };
}

// JS heap after a forced GC, in MB.
async function heapMB(cdp) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return usedSize / 1e6;
}

async function selectionHandles(page) {
  return page.locator('[data-overlay-page="1"] [data-resize-handle]').count();
}

async function oneRun(browser, { profile = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.route((u) => !['data:', 'blob:'].includes(u.protocol) && !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort('blockedbyclient'));
  if (process.env.RENDERS) await context.addInitScript(installRenderCounter);
  // PAINT=1 counts 2D canvas draw calls per canvas during each gesture.
  if (process.env.PAINT) {
    await context.addInitScript(() => {
      const counts = new Map(); window.__paint = counts; window.__paintOn = false;
      const desc = (c) => {
        const el = c.canvas;
        if (!(el instanceof HTMLCanvasElement)) return `offscreen ${el.width}x${el.height}`;
        const host = el.closest('[data-page-number],[data-overlay-page],[data-page]');
        const pg = host?.getAttribute('data-page-number') || host?.getAttribute('data-overlay-page') || host?.getAttribute('data-page') || '?';
        return `${String(el.className || '(no class)').slice(0, 40)} p${pg} ${el.width}x${el.height}${el.isConnected ? '' : ' detached'}`;
      };
      const note = (k) => { if (window.__paintOn) { const st = (new Error().stack || '').split('\n').slice(2, 5).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < '); const key = `${k} @ ${st}`; counts.set(key, (counts.get(key) || 0) + 1); } };
      for (const fn of ['getContext', 'toDataURL', 'toBlob', 'transferToImageBitmap']) {
        const orig = HTMLCanvasElement.prototype[fn];
        if (orig) HTMLCanvasElement.prototype[fn] = function (...a) { note(`${fn} ${desc({ canvas: this })}`); return orig.apply(this, a); };
      }
      for (const prop of ['width', 'height']) {
        const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop);
        Object.defineProperty(HTMLCanvasElement.prototype, prop, { ...d, set(v) { note(`set ${prop} ${desc({ canvas: this })}`); d.set.call(this, v); } });
      }
      for (const fn of ['fill', 'stroke', 'fillText', 'drawImage', 'fillRect', 'clearRect', 'putImageData']) {
        const orig = CanvasRenderingContext2D.prototype[fn];
        CanvasRenderingContext2D.prototype[fn] = function (...a) {
          if (window.__paintOn) { const k = `${fn} ${desc(this)}`; counts.set(k, (counts.get(k) || 0) + 1); }
          return orig.apply(this, a);
        };
      }
    });
  }
  const page = await context.newPage();
  await signInAndOpen(page);
  const cdp = await context.newCDPSession(page);
  // CPU=<n> slows the page n times after it is open (a slower laptop or tablet).
  if (process.env.CPU) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU) });
  if (process.env.LOAF_DETAIL) await page.evaluate(() => { window.__loafDetail = true; });
  const heapOpenMB = await heapMB(cdp);
  const marks = await page.locator('[data-overlay-page="1"] [data-annotation-index]').count();
  // Switching to Select: main-thread cost over the next 1.8 s (the switch's
  // own render plus anything scheduled off it).
  await startSampling(page);
  await page.keyboard.press('v');
  await sleep(1800);
  const toolSwitch = await stopSampling(page);
  await sleep(500);
  const out = { marks, heapOpenMB, heapAfterSwitchMB: await heapMB(cdp), toolSwitch };
  const prof = (g) => (profile ? profile.replace(/(\.cpuprofile)?$/, `-${g}.cpuprofile`) : null);
  const settle = async () => { await page.keyboard.press('Control+z'); await sleep(400); await page.keyboard.press('Escape'); await sleep(600); };

  if (GESTURES.includes('move')) {
    const [t] = await markTargets(page, 1);
    if (!t) throw new Error('no mark in view on page 1');
    await page.mouse.click(t.x, t.y);
    await sleep(300);
    out.move = await drag(page, cdp, t, 120, 80, { profile: prof('move'), watch: t.index });
    await settle();
  }
  if (GESTURES.includes('multi')) {
    const ts = await markTargets(page, MULTI);
    if (ts.length < 2) throw new Error('not enough marks in view for a multi-selection');
    await page.mouse.click(ts[0].x, ts[0].y);
    await page.keyboard.down('Shift');
    for (const t of ts.slice(1)) await page.mouse.click(t.x, t.y);
    await page.keyboard.up('Shift');
    await sleep(300);
    if (process.env.DEBUG) { await page.screenshot({ path: process.env.DEBUG }); console.log('targets', JSON.stringify(ts.map((t) => [t.index, Math.round(t.x), Math.round(t.y)]))); }
    out.multi = await drag(page, cdp, ts[0], 120, 80, { profile: prof('multi'), watch: ts[ts.length - 1].index });
    out.multi.selected = ts.length;
    await settle();
  }
  if (GESTURES.includes('resize')) {
    const [t] = await markTargets(page, 1);
    if (!t) throw new Error(`no mark in view for the resize (${await page.locator('[data-overlay-page="1"] g[data-annotation-index]').count()} marks mounted)`);
    await page.mouse.click(t.x, t.y);
    await sleep(300);
    if (!(await selectionHandles(page))) throw new Error('no resize handles after selecting a mark');
    const handle = await page.evaluate(() => {
      const hs = [...document.querySelectorAll('[data-overlay-page="1"] [data-resize-handle]')].map((h) => ({ id: h.getAttribute('data-resize-handle'), r: h.getBoundingClientRect() }));
      const right = hs.filter((h) => h.id === 'br' || h.id === 'mr').sort((a, b) => b.r.right - a.r.right)[0] || hs[0];
      return { id: right.id, x: right.r.left + right.r.width / 2, y: right.r.top + right.r.height / 2 };
    });
    out.resize = await drag(page, cdp, handle, 140, handle.id === 'mr' ? 0 : 60, { profile: prof('resize') });
    out.resize.handle = handle.id;
    await settle();
  }
  await context.close();
  return out;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const browser = await chromium.launch({ executablePath: exe });
if (PROFILE) {
  console.log('profiled', JSON.stringify(await oneRun(browser, { profile: PROFILE })));
} else {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const r = await oneRun(browser);
    runs.push(r);
    console.log(`run ${i + 1}`, JSON.stringify(r, (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)));
  }
  const summary = { marks: runs[0].marks, heapOpenMB: Math.round(median(runs.map((r) => r.heapOpenMB)) * 10) / 10, heapAfterSwitchMB: Math.round(median(runs.map((r) => r.heapAfterSwitchMB)) * 10) / 10 };
  for (const g of ['toolSwitch', ...GESTURES]) {
    summary[g] = Object.fromEntries(['frames', 'meanFrame', 'p95Frame', 'overVsync', 'over33', 'loafCount', 'loafMs', 'loafScriptMs', 'taskMs', 'scriptMs', 'styleMs', 'layoutMs', 'commits', 'renders', 'hostElements', 'wall', 'dropLoafMs', 'dropScriptMs', 'dropOver33', 'dropTaskMs']
      .map((k) => [k, Math.round(median(runs.map((r) => r[g]?.[k] ?? 0)) * 10) / 10]));
  }
  console.log('MEDIANS', JSON.stringify(summary));
}
await browser.close();
