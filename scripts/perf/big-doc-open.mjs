#!/usr/bin/env node
// Open-path profiler for a big drawing set on the LOCAL e2e stack.
// Seed first: node scripts/perf/big-doc-seed.mjs. Serve a build of the app
// (`npx vite build --mode e2e --outDir <dir>` + `npx vite preview --mode e2e
// --outDir <dir> --port 5241`), then:
//
//   BASE=http://127.0.0.1:5241 RUNS=5 node scripts/perf/big-doc-open.mjs
//
// Each run is a cold browser context (no IndexedDB / HTTP cache), signs in as
// the e2e owner, and times from the "Open file" click to:
//   firstPage   - page 1 of the PDF is drawn and uncovered (its canvas past
//                 the 300x150 default size, overlay pdf-ready, no hydration cover)
//   marks       - page 1's markups are on screen (SVG shapes in its overlay)
//   interactive - marks are up AND the main thread is free: the end of the last
//                 long task (>50 ms) before a QUIET_MS window with none
//   editable    - marks are up and page 1 takes input: the open has finished
//                 (no preview input blocker, no hydration gate)
// and also reports the long-task total (blocking time) up to interactive.
// loafBlocking / loafLongest: the same from long animation frames (their
// blockingDuration), which also catch slow promise callbacks the long-task
// entries miss (a 0.65 s tail-read frame on a dense reopen, round 6).
// heapMB is the JS heap after the open settles and a forced GC.
// THUMB=1 also waits for the viewer's page-1 thumbnail (markup) to be written
// and reports when it landed (thumbAt, ms after the click) and its size.
// REOPEN=1 times a second open of the same document in the same browser
// profile (IndexedDB / HTTP cache warm, thumbnail already current).
// PROFILE=<file.cpuprofile> records a CPU profile of the first run instead
// (of its reopen with REOPEN=1).
// NET=<latency ms>/<down Mbps> throttles the page's network (e.g. 150/9).
// NO_WARMUP=1 skips the untimed warm-up run (interleaved A/B loops).
// TIMERS=<ms> logs every long animation frame over <ms> (default 80) with its
// script entry points; a timer / idle / rAF entry also gets the stack that
// scheduled it (map the minified frames with a --sourcemap build).
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE || 'http://127.0.0.1:5241';
const RUNS = Number(process.env.RUNS || 5);
const QUIET_MS = Number(process.env.QUIET_MS || 5000);
const SIZES = (process.env.SIZES || 'desktop,phone').split(',');
// LINK=1 opens by share link (/?docId=) instead of from Home.
const LINK = process.env.LINK === '1';
const DOC_ID = process.env.BIG_DOC_ID || 'e2eb1600-0000-4000-8000-000000000201';
const DOC_NAME = process.env.BIG_DOC_NAME || 'Big Drawing Set.pdf';
const PROFILE = process.env.PROFILE || null;
const NET = process.env.NET || null;
const exe = process.env.PW_CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

// Injected before any app code: long-task log + a rAF probe for the milestones.
const PROBE = () => {
  const w = window;
  w.__bigOpen = { ev: [], t0: null, firstPage: null, marks: null, editable: null, longTasks: [], frames: [] };
  // A share-link open (?docId=) is timed from navigation start.
  if (new URLSearchParams(location.search).has('docId')) w.__bigOpen.t0 = 0;
  const origLog = console.log;
  console.log = (...args) => {
    const text = String(args[0] ?? '');
    if (w.__bigOpen.t0 != null && /LOAD-TRACE|OpenTiming|InteractionDiag/.test(text)) w.__bigOpen.ev.push(`${Math.round(performance.now() - w.__bigOpen.t0)} LOG ${text.replace(/%c|color:.*$/g, '').slice(0, 90)}`);
    return origLog.apply(console, args);
  };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__bigOpen.longTasks.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* no longtask support */ }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__bigOpen.frames.push([e.startTime, e.duration, e.blockingDuration || 0]);
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch { /* no LoAF support */ }
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('button');
    if (button && /Open file/.test(button.getAttribute('aria-label') || button.textContent || '') && w.__bigOpen.t0 == null) {
      w.__bigOpen.t0 = performance.now();
    }
  }, true);
  const tick = () => {
    const s = w.__bigOpen;
    if (s.t0 != null) {
      const host = document.querySelector('[data-overlay-page="1"]');
      const canvas = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"] canvas.survey-pdfjs-page-canvas');
      // A canvas pdf.js has not drawn yet keeps the default 300x150 size.
      const drawn = canvas && canvas.width > 0 && !(canvas.width === 300 && canvas.height === 150);
      // Page 1 stays under a cover until its marks are ready (by design); a
      // page drawn underneath the cover is not on screen yet.
      const overlay = host?.querySelector('[data-pdf-ready]');
      const covered = overlay?.getAttribute('data-annotation-hydration-gated') === 'true'
        || overlay?.getAttribute('data-annotation-visual-cover-active') === 'true';
      if (s.firstPage == null && drawn && !covered && overlay?.getAttribute('data-pdf-ready') === 'true') s.firstPage = performance.now();
      if (s.ev) {
        const el = host?.querySelector('[data-page-annotation-object-count]');
        const cnt = Number(el?.getAttribute('data-page-annotation-object-count') || 0);
        const gate = el?.getAttribute('data-annotation-hydration-gated');
        const cov = el?.getAttribute('data-annotation-visual-cover-active');
        const ready = el?.getAttribute('data-pdf-ready');
        const key = `cnt>0=${cnt > 0} gated=${gate} cover=${cov} pdfReady=${ready} canvas=${canvas?.width || 0}x${canvas?.height || 0}`;
        if (key !== s.lastKey) { s.lastKey = key; s.ev.push(`${Math.round(performance.now() - s.t0)} ${key}`); }
      }
      if (s.marks == null && host && host.querySelector('svg path, svg rect, svg ellipse, svg text, svg foreignObject')) s.marks = performance.now();
      // While the saved copy is only previewed, a blocker covers the page.
      if (s.marks != null && s.editable == null && overlay
        && overlay.getAttribute('data-annotation-hydration-gated') !== 'true'
        && !document.querySelector('[data-annotation-preview-input-blocker]')) s.editable = performance.now();
    }
    if (s.marks == null || s.firstPage == null || s.editable == null) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  w.__bigOpenRestart = () => requestAnimationFrame(tick);
};

// Wraps the timer APIs so a slow callback can be traced to its scheduler.
const TIMER_PROBE = (minMs) => {
  const w = window;
  w.__timerFires = [];
  const wrap = (name) => {
    const orig = w[name];
    if (typeof orig !== 'function') return;
    w[name] = function wrapped(cb, ...rest) {
      if (typeof cb !== 'function') return orig.call(this, cb, ...rest);
      const stack = new Error().stack;
      const delay = typeof rest[0] === 'number' ? rest[0] : null;
      return orig.call(this, function timed(...args) {
        // A callback that only resolves a promise (await-a-timer yields) does
        // its work in the microtasks after it returns, so record every fire
        // and match it to the long animation frame script that covers it.
        w.__timerFires.push({ api: name, delay, start: performance.now(), stack });
        if (w.__timerFires.length > 4000) w.__timerFires.splice(0, 2000);
        return cb.apply(this, args);
      }, ...rest);
    };
  };
  ['setTimeout', 'setInterval', 'requestIdleCallback', 'requestAnimationFrame'].forEach(wrap);
  // Long animation frames name the script entry point of every slow task,
  // whatever scheduled it (timer, message, promise, event).
  w.__slowFrames = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < minMs) continue;
        const t0 = w.__bigOpen?.t0 ?? 0;
        w.__slowFrames.push({
          at: Math.round(e.startTime - t0),
          dur: Math.round(e.duration),
          scripts: (e.scripts || []).filter((x) => x.duration >= 20).map((x) => {
            let line = `${x.invokerType} ${x.invoker} ${Math.round(x.duration)}ms ${x.sourceFunctionName || '?'} @ ${String(x.sourceURL).split('/').pop()}:${x.sourceCharPosition}`;
            if (x.invokerType === 'user-callback') {
              const fire = w.__timerFires.find((f) => f.start >= x.startTime - 1 && f.start <= x.startTime + 5);
              if (fire) line += `\n      scheduled (${fire.api}, delay ${fire.delay}) from\n        ${fire.stack.split('\n').slice(2, 10).map((l) => l.trim()).join('\n        ')}`;
            }
            return line;
          }),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch { /* no LoAF support */ }
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

// The viewer writes page 1 (with its markup) to the thumbnail cache a few
// seconds after the open; read that row straight from IndexedDB.
async function waitForThumbnail(page, timeoutMs = 20_000) {
  const read = () => page.evaluate((docId) => new Promise((resolve) => {
    const open = indexedDB.open('survey-thumbnail-cache-v1');
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('thumbs')) { db.close(); resolve(null); return; }
      const all = db.transaction('thumbs', 'readonly').objectStore('thumbs').getAll();
      all.onsuccess = () => {
        const row = all.result.find((r) => String(r.key).startsWith(`${docId}::`) && r.source === 'markup');
        db.close();
        if (!row) { resolve(null); return; }
        const s = window.__bigOpen;
        const wallT0 = Date.now() - (performance.now() - s.t0);
        // A short content hash, to compare the image two builds wrote.
        let h = 0x811c9dc5;
        for (let i = 0; i < row.url.length; i += 1) h = Math.imul(h ^ row.url.charCodeAt(i), 0x01000193) >>> 0;
        resolve({ thumbAt: row.savedAt - wallT0, thumbKB: row.url.length / 1024, thumbType: row.url.slice(5, row.url.indexOf(';')), thumbHash: h.toString(36) });
      };
      all.onerror = () => { db.close(); resolve(null); };
    };
  }), DOC_ID);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await read();
    if (row) return row;
    await page.waitForTimeout(500);
  }
  return { thumbAt: NaN, thumbKB: 0, thumbType: 'none', thumbHash: 'none' };
}

async function openAndSettle(page, context, size, { profile = null } = {}) {
  let cdp = null;
  if (LINK) {
    // Share link: an accepted invite / share email lands on /?docId=<id>.
    await page.waitForTimeout(500);
    await page.goto(`${BASE}/?docId=${DOC_ID}`);
  } else {
  const row = page.getByText(DOC_NAME, { exact: true }).filter({ visible: true }).first();
  // Desktop selects the row then opens with "Open file"; phone opens on the tap.
  if (size === 'desktop') await row.click();
  if (profile) {
    cdp = await context.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  if (size === 'desktop') await page.getByRole('button', { name: 'Open file' }).first().click();
  else if (size === 'tablet') {
    // The tablet layout selects the row on a tap and opens with "Open file".
    await row.tap();
    const openBtn = page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
    await openBtn.waitFor({ timeout: 10_000 });
    await page.evaluate(() => { window.__bigOpen.t0 = performance.now(); });
    await openBtn.tap();
  } else { await page.evaluate(() => { window.__bigOpen.t0 = performance.now(); }); await row.tap(); }
  }
  await page.waitForFunction(() => window.__bigOpen?.marks != null && window.__bigOpen?.firstPage != null && window.__bigOpen?.editable != null, null, { timeout: 120_000, polling: 100 });
  // Wait until QUIET_MS passes with no long task after the marks are up.
  const result = await page.waitForFunction((quiet) => {
    const s = window.__bigOpen;
    const now = performance.now();
    const lastEnd = s.longTasks.reduce((m, [st, d]) => Math.max(m, st + d), 0);
    const ready = Math.max(s.marks, lastEnd);
    if (now - ready < quiet) return null;
    const interactive = ready;
    const blocking = s.longTasks.filter(([st]) => st >= s.t0 && st < interactive).reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0);
    const longest = s.longTasks.filter(([st]) => st >= s.t0).reduce((m, [, d]) => Math.max(m, d), 0);
    const frames = s.frames.filter(([st]) => st >= s.t0 && st < interactive);
    const loafBlocking = frames.reduce((sum, [, , b]) => sum + b, 0);
    const loafLongest = frames.reduce((m, [, d]) => Math.max(m, d), 0);
    return { ev: s.ev.join(' | '), loafBlocking, loafLongest, tasks: s.longTasks.filter(([st]) => st >= s.t0).map(([st, d]) => `${Math.round(st - s.t0)}+${Math.round(d)}`).join(' '), firstPage: s.firstPage - s.t0, marks: s.marks - s.t0, editable: s.editable - s.t0, interactive: interactive - s.t0, blocking, longest };
  }, QUIET_MS, { timeout: 180_000, polling: 250 }).then((h) => h.jsonValue());
  if (process.env.TIMERS) {
    const frames = await page.evaluate(() => window.__slowFrames || []);
    for (const f of frames) console.log(`  frame at ${f.at} ms ${f.dur} ms\n    ${f.scripts.join('\n    ')}`);
  }
  if (cdp) {
    const { profile: cpu } = await cdp.send('Profiler.stop');
    fs.writeFileSync(profile, JSON.stringify(cpu));
  }
  if (process.env.THUMB) Object.assign(result, await waitForThumbnail(page));
  const heap = await context.newCDPSession(page);
  await heap.send('HeapProfiler.collectGarbage');
  result.heapMB = (await heap.send('Runtime.getHeapUsage')).usedSize / 1e6;
  await heap.detach();
  return result;
}

async function oneRun(browser, size, { profile = null } = {}) {
  const context = await browser.newContext(DEVICES[size]);
  await context.route((u) => !['data:', 'blob:'].includes(u.protocol) && !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort('blockedbyclient'));
  await context.addInitScript(PROBE);
  if (process.env.TIMERS) await context.addInitScript(TIMER_PROBE, Number(process.env.TIMERS) || 80);
  // FLAGS=a,b turns those feature flags on for the run (src/featureFlags.js).
  if (process.env.FLAGS) await context.addInitScript((keys) => { for (const k of keys) localStorage.setItem(`survey.flag.${k}`, '1'); }, process.env.FLAGS.split(','));
  const page = await context.newPage();
  if (NET) {
    // NET=<latency ms>/<down Mbps>, e.g. 150/9 for a phone on 4G.
    const [latency, mbps] = NET.split('/').map(Number);
    const net = await context.newCDPSession(page);
    await net.send('Network.enable');
    await net.send('Network.emulateNetworkConditions', {
      offline: false, latency, downloadThroughput: (mbps * 1e6) / 8, uploadThroughput: (mbps * 1e6) / 16,
    });
  }
  await signIn(page);
  // With REOPEN=1, PROFILE records the reopen instead of the first open.
  let result = await openAndSettle(page, context, size, { profile: process.env.REOPEN ? null : profile });
  if (process.env.REOPEN) {
    // Close the document (back to Home, same profile), then open it again.
    const close = size === 'phone'
      ? page.getByRole('button', { name: 'Back to documents' })
      : page.getByRole('button', { name: `Close ${DOC_NAME}` });
    await close.first().click();
    await page.evaluate(() => { const s = window.__bigOpen; Object.assign(s, { t0: null, firstPage: null, marks: null, editable: null, ev: [], lastKey: null }); });
    await page.getByText(DOC_NAME, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    // The probe's rAF loop stopped once the first open was timed.
    await page.evaluate(() => window.__bigOpenRestart?.());
    result = await openAndSettle(page, context, size, { profile });
  }
  await context.close();
  return result;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const browser = await chromium.launch({ executablePath: exe });
const summary = {};
for (const size of SIZES) {
  if (PROFILE) {
    const r = await oneRun(browser, size, { profile: PROFILE.replace(/(\.cpuprofile)?$/, `-${size}.cpuprofile`) });
    console.log(size, 'profiled', JSON.stringify(r));
    continue;
  }
  if (!process.env.NO_WARMUP) await oneRun(browser, size).catch(() => {}); // warm-up (server caches, JIT of vite preview)
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const r = await oneRun(browser, size);
    runs.push(r);
    if (process.env.TASKS) console.log('  long tasks', r.tasks, '\n  ev\n   ', r.ev.split(' | ').join('\n    '));
    delete r.ev;
    delete r.tasks;
    console.log(size, `run ${i + 1}`, Object.entries(r).map(([k, v]) => `${k}=${typeof v === 'number' ? Math.round(v) : v}`).join(' '));
  }
  summary[size] = Object.fromEntries(['firstPage', 'marks', 'editable', 'interactive', 'blocking', 'longest', 'loafBlocking', 'loafLongest', 'heapMB', 'thumbAt']
    .filter((k) => runs.every((r) => typeof r[k] === 'number'))
    .map((k) => [k, Math.round(median(runs.map((r) => r[k])))]));
}
await browser.close();
if (!PROFILE) console.log('MEDIANS', JSON.stringify(summary));
