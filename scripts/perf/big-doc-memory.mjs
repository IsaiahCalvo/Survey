#!/usr/bin/env node
// Pan/zoom smoothness and memory profiler for the big drawing set on the LOCAL
// e2e stack. Seed and serve exactly as for big-doc-open.mjs, then:
//
//   BASE=http://127.0.0.1:5241 RUNS=3 node scripts/perf/big-doc-memory.mjs
//
// Per device size (phone 390x844, tablet 1024x1366 by default) each run opens
// the set in a cold context and records:
//   firstPage            - open click to page 1 drawn (same rule as big-doc-open)
//   heapOpenMB           - JS heap after open settles (after a forced GC)
//   pan*                 - flick-scrolls down PAN_PAGES sheets and back up:
//                          long-task total, longest task, dropped frames
//   zoom*                - ctrl+wheel zoom in then out over the middle sheet
//   heapEndMB            - JS heap after pan + zoom (after a forced GC)
//   canvasMB / canvases  - backing-store bytes of every live <canvas> at the end
//   pagesDrawn           - page canvases still holding a drawn bitmap
//   overlays             - per-page markup overlays still mounted
// OUT=<file.json> writes every run. NET=<latency ms>/<down Mbps> throttles.
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:5241';
const RUNS = Number(process.env.RUNS || 3);
const SIZES = (process.env.SIZES || 'phone,tablet').split(',');
const PAN_PAGES = Number(process.env.PAN_PAGES || 30);
const DOC_NAME = process.env.BIG_DOC_NAME || 'Big Drawing Set.pdf';
const NET = process.env.NET || null;
const OUT = process.env.OUT || null;
const HEAP_TOP = Number(process.env.HEAP_TOP || 0);
const heapTop = {};
// ZOOM_PROFILE=<file> records a CPU profile of the first run's zoom gesture per size.
const ZOOM_PROFILE = process.env.ZOOM_PROFILE || null;
const profiled = {};
const exe = process.env.PW_CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

const PROBE = () => {
  const w = window;
  w.__perf = { t0: null, firstPage: null, longTasks: [], frames: [], recording: false };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__perf.longTasks.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* no longtask support */ }
  let last = 0;
  const frame = (t) => {
    const s = w.__perf;
    if (s.recording && last) s.frames.push(t - last);
    last = t;
    if (s.t0 != null && s.firstPage == null) {
      const canvas = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"] canvas.survey-pdfjs-page-canvas');
      const overlay = document.querySelector('[data-overlay-page="1"] [data-pdf-ready]');
      const drawn = canvas && canvas.width > 0 && !(canvas.width === 300 && canvas.height === 150);
      const covered = overlay?.getAttribute('data-annotation-hydration-gated') === 'true'
        || overlay?.getAttribute('data-annotation-visual-cover-active') === 'true';
      if (drawn && !covered && overlay?.getAttribute('data-pdf-ready') === 'true') s.firstPage = performance.now();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

async function signIn(page) {
  await page.goto(`${BASE}/`);
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await dialog.waitFor({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill('e2e-owner@example.com');
  await dialog.getByLabel('Password').fill('E2e-local-only-123!');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 60_000 });
}

const quiet = (page, ms = 2000) => page.waitForFunction((q) => {
  const s = window.__perf;
  const lastEnd = s.longTasks.reduce((m, [st, d]) => Math.max(m, st + d), 0);
  return performance.now() - lastEnd > q;
}, ms, { timeout: 120_000, polling: 250 });

async function heapMB(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const used = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value || 0;
  return used / 1e6;
}

// Long tasks and frame gaps inside [start, now).
async function window_(page, start) {
  return page.evaluate((t0) => {
    const s = window.__perf;
    const tasks = s.longTasks.filter(([st]) => st >= t0);
    const dropped = s.frames.reduce((n, dt) => n + Math.max(0, Math.round(dt / (1000 / 60)) - 1), 0);
    const r = {
      blocking: tasks.reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0),
      longest: tasks.reduce((m, [, d]) => Math.max(m, d), 0),
      dropped,
      frames: s.frames.length,
    };
    s.frames = [];
    s.recording = false;
    return r;
  }, start);
}

// Self size by constructor name from a heap snapshot (top HEAP_TOP rows).
async function heapByConstructor(cdp) {
  const chunks = [];
  const onChunk = (e) => chunks.push(e.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  const snap = JSON.parse(chunks.join(''));
  const f = snap.snapshot.meta.node_fields;
  const types = snap.snapshot.meta.node_types[0];
  const iType = f.indexOf('type'); const iName = f.indexOf('name'); const iSize = f.indexOf('self_size');
  const by = new Map();
  for (let i = 0; i < snap.nodes.length; i += f.length) {
    const key = `${types[snap.nodes[i + iType]]}:${snap.strings[snap.nodes[i + iName]].slice(0, 60)}`;
    const v = by.get(key) || [0, 0];
    v[0] += snap.nodes[i + iSize]; v[1] += 1;
    by.set(key, v);
  }
  const rows = [...by].sort((a, b) => b[1][0] - a[1][0]).slice(0, HEAP_TOP).map(([k, [b, n]]) => `${(b / 1e6).toFixed(2)}MB x${n} ${k}`);
  // Retainer chains of the biggest groups: a sample of nodes from each of the
  // top 4 rows, each walked up its first strong retainer, then counted.
  const ef = snap.snapshot.meta.edge_fields;
  const edgeTypes = snap.snapshot.meta.edge_types[0];
  const iEdgeCount = f.indexOf('edge_count');
  const iEType = ef.indexOf('type'); const iEName = ef.indexOf('name_or_index'); const iTo = ef.indexOf('to_node');
  const retainer = new Int32Array(snap.nodes.length / f.length).fill(-1);
  const retEdge = new Array(retainer.length);
  for (let n = 0, e = 0; n < snap.nodes.length; n += f.length) {
    const count = snap.nodes[n + iEdgeCount];
    for (let k = 0; k < count; k += 1, e += ef.length) {
      const type = edgeTypes[snap.edges[e + iEType]];
      if (type === 'weak' || type === 'shortcut') continue;
      const to = snap.edges[e + iTo] / f.length;
      if (retainer[to] === -1) {
        retainer[to] = n / f.length;
        const nm = snap.edges[e + iEName];
        retEdge[to] = type === 'element' || type === 'hidden' ? `[${type === 'element' ? 'i' : 'h'}]` : snap.strings[nm];
      }
    }
  }
  const nodeName = (i) => `${types[snap.nodes[i * f.length + iType]]}:${snap.strings[snap.nodes[i * f.length + iName]].slice(0, 30)}`;
  const topKeys = [...by].sort((a, b) => b[1][0] - a[1][0]).slice(0, 4).map(([k]) => k);
  for (const key of topKeys) {
    const chains = new Map();
    let seen = 0;
    for (let i = 0; i < retainer.length && seen < 3000; i += 1) {
      if (nodeName(i) !== key.slice(0, key.indexOf(':') + 31) && `${types[snap.nodes[i * f.length + iType]]}:${snap.strings[snap.nodes[i * f.length + iName]].slice(0, 60)}` !== key) continue;
      if ((i * 7919) % 13 !== 0) continue; // spread the sample
      seen += 1;
      const parts = [];
      for (let cur = i, d = 0; cur >= 0 && d < 9; cur = retainer[cur], d += 1) parts.push(`${retEdge[cur] ?? ''}<${nodeName(cur)}`);
      const chain = parts.slice(1).join(' ');
      chains.set(chain, (chains.get(chain) || 0) + 1);
    }
    rows.push(`RETAINERS of ${key} (sample ${seen})`);
    for (const [c, n] of [...chains].sort((a, b) => b[1] - a[1]).slice(0, 6)) rows.push(`   ${n} ${c}`);
  }
  return rows;
}

async function snapshotDom(page) {
  return page.evaluate(() => {
    let bytes = 0;
    const all = [...document.querySelectorAll('canvas')];
    for (const c of all) bytes += c.width * c.height * 4;
    const pageCanvases = [...document.querySelectorAll('canvas.survey-pdfjs-page-canvas')];
    return {
      canvasMB: bytes / 1e6,
      canvases: all.length,
      pagesDrawn: pageCanvases.filter((c) => c.width > 0 && !(c.width === 300 && c.height === 150)).length,
      overlays: document.querySelectorAll('[data-overlay-page]').length,
      domNodes: document.getElementsByTagName('*').length,
    };
  });
}

async function scroller(page) {
  return page.evaluateHandle(() => {
    let el = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]');
    while (el && el !== document.body) {
      const st = getComputedStyle(el);
      if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 10) return el;
      el = el.parentElement;
    }
    return document.scrollingElement;
  });
}

async function oneRun(browser, size) {
  const context = await browser.newContext(DEVICES[size]);
  await context.route((u) => !['data:', 'blob:'].includes(u.protocol) && !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort('blockedbyclient'));
  await context.addInitScript(PROBE);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (NET) {
    const [latency, mbps] = NET.split('/').map(Number);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency, downloadThroughput: (mbps * 1e6) / 8, uploadThroughput: (mbps * 1e6) / 16,
    });
  }
  await signIn(page);
  const row = page.getByText(DOC_NAME, { exact: true }).filter({ visible: true }).first();
  if (size === 'desktop') {
    await row.click();
    await page.evaluate(() => { window.__perf.t0 = performance.now(); });
    await page.getByRole('button', { name: 'Open file' }).first().click();
  } else {
    await page.evaluate(() => { window.__perf.t0 = performance.now(); });
    await row.tap();
    // Wider touch layouts select the row on a tap and open with "Open file".
    const openBtn = page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
    await page.waitForTimeout(400);
    if (await page.evaluate(() => !document.querySelector('.survey-pdfjs-page-div')) && await openBtn.isVisible().catch(() => false)) await openBtn.tap();
  }
  await page.waitForFunction(() => window.__perf.firstPage != null, null, { timeout: 120_000, polling: 100 });
  const firstPage = await page.evaluate(() => window.__perf.firstPage - window.__perf.t0);
  await quiet(page, 3000);
  const heapOpenMB = await heapMB(cdp);
  const open = await snapshotDom(page);

  // Pan: flick down PAN_PAGES sheets, then back to the top.
  const sc = await scroller(page);
  const box = await page.evaluate((el) => ({ h: el.clientHeight, sh: el.scrollHeight, pages: document.querySelectorAll('.survey-pdfjs-page-div').length }), sc);
  const perPage = box.sh / Math.max(1, box.pages);
  const vp = DEVICES[size].viewport;
  await page.mouse.move(vp.width / 2, vp.height / 2);
  let start = await page.evaluate(() => { window.__perf.frames = []; window.__perf.recording = true; return performance.now(); });
  const steps = Math.ceil((PAN_PAGES * perPage) / 400);
  await page.evaluate((el) => { window.__perf.maxScroll = 0; el.addEventListener('scroll', () => { window.__perf.maxScroll = Math.max(window.__perf.maxScroll, el.scrollTop); }, { passive: true }); }, sc);
  for (let i = 0; i < steps; i += 1) { await page.mouse.wheel(0, 400); await page.waitForTimeout(16); }
  for (let i = 0; i < steps; i += 1) { await page.mouse.wheel(0, -400); await page.waitForTimeout(16); }
  await page.waitForTimeout(500);
  const pan = await window_(page, start);
  pan.maxScroll = await page.evaluate(() => window.__perf.maxScroll || 0);
  await quiet(page);

  // Zoom: ctrl+wheel in then out, mid-viewport.
  const zoomProfile = ZOOM_PROFILE && !profiled[size] ? ZOOM_PROFILE.replace(/(\.cpuprofile)?$/, `-${size}.cpuprofile`) : null;
  if (zoomProfile) {
    profiled[size] = true;
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  start = await page.evaluate(() => { window.__perf.frames = []; window.__perf.recording = true; return performance.now(); });
  await page.keyboard.down('Control');
  for (let i = 0; i < 12; i += 1) { await page.mouse.wheel(0, -60); await page.waitForTimeout(30); }
  await page.waitForTimeout(800);
  for (let i = 0; i < 12; i += 1) { await page.mouse.wheel(0, 60); await page.waitForTimeout(30); }
  await page.keyboard.up('Control');
  await page.waitForTimeout(800);
  const zoom = await window_(page, start);
  if (zoomProfile) fs.writeFileSync(zoomProfile, JSON.stringify((await cdp.send('Profiler.stop')).profile));
  await quiet(page);
  const heapEndMB = await heapMB(cdp);
  if (HEAP_TOP && !heapTop[size]) heapTop[size] = await heapByConstructor(cdp);
  const end = await snapshotDom(page);
  await context.close();
  return {
    firstPage, heapOpenMB, canvasOpenMB: open.canvasMB, pagesDrawnOpen: open.pagesDrawn,
    panBlocking: pan.blocking, panLongest: pan.longest, panDropped: pan.dropped,
    zoomBlocking: zoom.blocking, zoomLongest: zoom.longest, zoomDropped: zoom.dropped,
    panScrolledPages: pan.maxScroll / perPage,
    heapEndMB, canvasMB: end.canvasMB, canvases: end.canvases, pagesDrawn: end.pagesDrawn, overlays: end.overlays, domNodes: end.domNodes,
  };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const browser = await chromium.launch({ executablePath: exe, args: ['--enable-precise-memory-info'] });
const summary = {};
const all = {};
for (const size of SIZES) {
  await oneRun(browser, size).catch((e) => console.log(size, 'warm-up failed', e.message));
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const r = await oneRun(browser, size);
    runs.push(r);
    console.log(size, `run ${i + 1}`, Object.entries(r).map(([k, v]) => `${k}=${Math.round(v * 10) / 10}`).join(' '));
  }
  all[size] = runs;
  if (heapTop[size]) console.log(size, 'heap by constructor\n  ' + heapTop[size].join('\n  '));
  summary[size] = Object.fromEntries(Object.keys(runs[0]).map((k) => [k, Math.round(median(runs.map((r) => r[k])) * 10) / 10]));
}
await browser.close();
console.log('MEDIANS', JSON.stringify(summary));
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, runs: all, heapTop }, null, 2));
