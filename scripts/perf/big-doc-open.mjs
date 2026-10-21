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
// and also reports the long-task total (blocking time) up to interactive.
// PROFILE=<file.cpuprofile> records a CPU profile of the first run instead.
// NET=<latency ms>/<down Mbps> throttles the page's network (e.g. 150/9).
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
  w.__bigOpen = { ev: [], t0: null, firstPage: null, marks: null, longTasks: [] };
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
    }
    if (s.marks == null || s.firstPage == null) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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

async function oneRun(browser, size, { profile = null } = {}) {
  const context = await browser.newContext(DEVICES[size]);
  await context.route((u) => !['data:', 'blob:'].includes(u.protocol) && !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort('blockedbyclient'));
  await context.addInitScript(PROBE);
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
  if (LINK) {
    // Share link: an accepted invite / share email lands on /?docId=<id>.
    await page.waitForTimeout(500);
    await page.goto(`${BASE}/?docId=${DOC_ID}`);
  } else {
  const row = page.getByText(DOC_NAME, { exact: true }).filter({ visible: true }).first();
  // Desktop selects the row then opens with "Open file"; phone opens on the tap.
  if (size === 'desktop') await row.click();
  let cdp = null;
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
  await page.waitForFunction(() => window.__bigOpen?.marks != null && window.__bigOpen?.firstPage != null, null, { timeout: 120_000, polling: 100 });
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
    return { ev: s.ev.join(' | '), tasks: s.longTasks.filter(([st]) => st >= s.t0).map(([st, d]) => `${Math.round(st - s.t0)}+${Math.round(d)}`).join(' '), firstPage: s.firstPage - s.t0, marks: s.marks - s.t0, interactive: interactive - s.t0, blocking, longest };
  }, QUIET_MS, { timeout: 180_000, polling: 250 }).then((h) => h.jsonValue());
  if (cdp) {
    const { profile: cpu } = await cdp.send('Profiler.stop');
    fs.writeFileSync(profile, JSON.stringify(cpu));
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
  await oneRun(browser, size).catch(() => {}); // warm-up (server caches, JIT of vite preview)
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const r = await oneRun(browser, size);
    runs.push(r);
    if (process.env.TASKS) console.log('  long tasks', r.tasks, '\n  ev\n   ', r.ev.split(' | ').join('\n    '));
    delete r.ev;
    delete r.tasks;
    console.log(size, `run ${i + 1}`, Object.entries(r).map(([k, v]) => `${k}=${Math.round(v)}`).join(' '));
  }
  summary[size] = Object.fromEntries(['firstPage', 'marks', 'interactive', 'blocking', 'longest'].map((k) => [k, Math.round(median(runs.map((r) => r[k])))]));
}
await browser.close();
if (!PROFILE) console.log('MEDIANS', JSON.stringify(summary));
