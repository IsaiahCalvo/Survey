#!/usr/bin/env node
// Tab-switch restyle profiler on the LOCAL e2e stack. Seeds two documents
// (like tests/e2e-signed-in/tab-switch-smooth.spec.mjs): A, the 36-sheet
// debug/fixtures/package2-rev4.pdf (3k imported PDF marks), and B, the
// one-page clickable-link-test.pdf; removes them at the end. A_DOC=big uses
// the seeded Big Drawing Set (scripts/perf/big-doc-seed.mjs) as A instead.
// Serve one or more builds (see big-doc-open.mjs), then:
//
//   BASES=http://127.0.0.1:5241,http://127.0.0.1:5242 RUNS=5 node scripts/perf/tab-switch-style.mjs
//
// Runs interleave the builds (base, fix, base, fix ...). Each run is a cold
// context: sign in, open A then B, leave both settled (A with its Pages panel
// open and scrolled down the set, as the spec leaves it; PLAIN=1 skips that;
// ZOOMOUT=<n> also zooms A out n steps so most of its sheets are drawn),
// then SWITCHES clicks on the tab strip (A, B, A, B ...). Per switch, with a Chrome trace running:
//   ms      - pointerdown on the tab to the first frame that shows the tab
//   style   - Recalculate Style (UpdateLayoutTree) ms on the main thread from
//             the click to that frame, and the most elements one restyled
//   layout  - Layout ms over the same window
// plus the document's element count. The open of A is traced too (style /
// layout ms from "Open file" to a settled page 1).
// STATS=1 also records Chrome's CSS selector stats (the DevTools "Enable CSS
// selector stats" setting) and prints the selectors that cost most.
// TRACE=<file.json> saves the trace of the first switch to A (open it in
// DevTools' Performance panel, or node scripts/perf/trace-top.mjs <file>).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';
import { E2E_ACCOUNTS, E2E_PROJECT } from '../../tests/e2e-signed-in/accounts.mjs';

const BASES = (process.env.BASES || process.env.BASE || 'http://127.0.0.1:5241').split(',');
const RUNS = Number(process.env.RUNS || 5);
const SWITCHES = Number(process.env.SWITCHES || 6);
const STATS = process.env.STATS === '1';
const A_DOC = process.env.A_DOC || 'package2';
const ZOOMOUT = Number(process.env.ZOOMOUT || 0);
const exe = process.env.PW_CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readEnv() {
  const env = Object.fromEntries(fs.readFileSync('.env.e2e', 'utf8')
    .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const url = env.VITE_SUPABASE_URL;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url || '')) throw new Error(`refusing non-local Supabase URL ${url}`);
  return { url, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY };
}

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const stamp = Date.now();
  const docs = {};
  const list = [['B', 'debug/fixtures/clickable-link-test.pdf', 1]];
  if (A_DOC === 'big') docs.A = { docName: 'Big Drawing Set.pdf', pages: 240, seeded: false };
  else list.unshift(['A', 'debug/fixtures/package2-rev4.pdf', 36]);
  for (const [label, fixture, pages] of list) {
    const docId = randomUUID();
    const bytes = fs.readFileSync(path.resolve(fixture));
    const filePath = `${ownerId}/${docId}.pdf`;
    const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
    if (up.error) throw up.error;
    const docName = `Perf Tabs ${label} ${stamp}.pdf`;
    const ins = await admin.from('documents').insert({ id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName, file_path: filePath, file_size: bytes.length, page_count: pages });
    if (ins.error) throw ins.error;
    docs[label] = { docId, docName, filePath, pages, seeded: true };
  }
  return docs;
}

async function cleanup(admin, docs) {
  for (const d of Object.values(docs)) {
    if (!d.seeded) continue;
    await admin.from('documents').delete().eq('id', d.docId);
    await admin.storage.from('documents').remove([d.filePath]);
  }
}

const CATEGORIES = [
  'devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'loading',
  ...(STATS ? ['disabled-by-default-blink.debug'] : []),
];

async function traced(cdp, fn) {
  const events = [];
  const onData = ({ value }) => { for (const e of value) events.push(e); };
  cdp.on('Tracing.dataCollected', onData);
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: CATEGORIES }, transferMode: 'ReportEvents' });
  const out = await fn();
  const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.end');
  await done;
  cdp.off('Tracing.dataCollected', onData);
  return { out, events };
}

// Style / layout on the renderer main thread between two performance.now()
// marks (trace clock is microseconds; the page marks are converted through
// a clock-sync mark the page emits with console.timeStamp).
function summarise(events, fromUs, toUs, statsOut) {
  const main = new Set();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain') main.add(`${e.pid}:${e.tid}`);
  let style = 0; let layout = 0; let maxEls = 0; let recalcs = 0;
  for (const e of events) {
    if (e.ph !== 'X' || !main.has(`${e.pid}:${e.tid}`)) continue;
    if (e.ts < fromUs || e.ts > toUs) continue;
    if (e.name === 'UpdateLayoutTree') {
      style += e.dur / 1000; recalcs += 1;
      maxEls = Math.max(maxEls, e.args?.elementCount || 0);
    } else if (e.name === 'Layout') layout += e.dur / 1000;
  }
  if (statsOut) {
    for (const e of events) {
      if (e.name !== 'SelectorStats' || e.ts < fromUs || e.ts > toUs) continue;
      for (const s of e.args?.selector_stats?.selector_timings || []) {
        const cur = statsOut.get(s.selector) || { us: 0, attempts: 0, matches: 0 };
        cur.us += s['elapsed (us)'] || 0;
        cur.attempts += s.match_attempts || 0;
        cur.matches += s.match_count || 0;
        statsOut.set(s.selector, cur);
      }
    }
  }
  return { style, layout, maxEls, recalcs };
}

// The trace timestamp of a page mark: console.timeStamp lands as a
// TimeStamp event whose args carry the label.
function markUs(events, label) {
  const e = events.find((x) => x.name === 'TimeStamp' && (x.args?.data?.message === label || x.args?.data?.name === label));
  return e ? e.ts : null;
}

async function signIn(page, base) {
  await page.goto(`${base}/`);
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await dialog.waitFor({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill('e2e-owner@example.com');
  await dialog.getByLabel('Password').fill('E2e-local-only-123!');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 60_000 });
}

const visiblePages = () => {
  const surface = [...document.querySelectorAll('[data-touch-pdf-surface]')].find((s) => s.checkVisibility());
  return surface ? surface.querySelectorAll('.survey-pdfjs-page-div').length : 0;
};

async function waitQuiet(page, quietMs = 2500) {
  await page.evaluate(() => {
    window.__lastLong = performance.now();
    if (!window.__quietObs) {
      window.__quietObs = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lastLong = Math.max(window.__lastLong, e.startTime + e.duration); });
      window.__quietObs.observe({ type: 'long-animation-frame' });
    }
  });
  await page.waitForFunction((q) => performance.now() - window.__lastLong > q, quietMs, { timeout: 120_000, polling: 200 });
}

async function oneRun(browser, base, docs, stats) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await context.route((u) => !['data:', 'blob:'].includes(u.protocol) && !['127.0.0.1', 'localhost'].includes(u.hostname), (r) => r.abort('blockedbyclient'));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await signIn(page, base);
  const tabs = page.locator('.tab-bar');
  const result = { open: null, toA: [], toB: [], elements: 0 };
  for (const label of ['A', 'B']) {
    const d = docs[label];
    if (label === 'B') await tabs.getByText('Home', { exact: true }).click();
    await page.getByText(d.docName, { exact: true }).filter({ visible: true }).first().click();
    const openBtn = page.getByRole('button', { name: 'Open file' }).first();
    if (label === 'A') {
      const { events } = await traced(cdp, async () => {
        await page.evaluate(() => console.timeStamp('open-start'));
        await openBtn.click();
        await page.waitForFunction((n) => {
          const surface = [...document.querySelectorAll('[data-touch-pdf-surface]')].find((s) => s.checkVisibility());
          const c = surface?.querySelector('.survey-pdfjs-page-div[data-page-number="1"] canvas.survey-pdfjs-page-canvas');
          return surface && surface.querySelectorAll('.survey-pdfjs-page-div').length === n && c && !(c.width === 300 && c.height === 150);
        }, d.pages, { timeout: 120_000, polling: 100 });
        await waitQuiet(page);
        await page.evaluate(() => console.timeStamp('open-end'));
      });
      result.open = summarise(events, markUs(events, 'open-start'), markUs(events, 'open-end'), stats?.open);
    } else {
      await openBtn.click();
      await page.waitForFunction((n) => {
        const surface = [...document.querySelectorAll('[data-touch-pdf-surface]')].find((s) => s.checkVisibility());
        return surface && surface.querySelectorAll('.survey-pdfjs-page-div').length === n && surface.querySelector('canvas');
      }, d.pages, { timeout: 120_000, polling: 100 });
      await waitQuiet(page);
    }
  }
  // Leave A as the tab-switch spec does: Pages panel open, scrolled down
  // the set (more sheets drawn, 36 thumbnails in the panel).
  if (process.env.PLAIN !== '1') {
    await tabs.getByText(docs.A.docName, { exact: true }).click();
    await waitQuiet(page, 800);
    await page.getByRole('toolbar', { name: 'Document panels' }).getByRole('button', { name: 'Pages', exact: true }).click();
    await page.evaluate(() => { [...document.querySelectorAll('[data-touch-pdf-surface]')].find((s) => s.checkVisibility()).scrollTop = 3000; });
    await waitQuiet(page);
    // ZOOMOUT=<n> zooms A out n steps (Ctrl+-) so most sheets are drawn.
    if (ZOOMOUT) {
      await page.mouse.move(720, 450);
      for (let z = 0; z < ZOOMOUT; z += 1) { await page.keyboard.press('Control+Minus'); await sleep(400); }
      await waitQuiet(page);
    }
    await tabs.getByText(docs.B.docName, { exact: true }).click();
    await waitQuiet(page, 1200);
  }
  result.elements = await page.evaluate(() => document.getElementsByTagName('*').length);
  for (let i = 0; i < SWITCHES; i += 1) {
    const label = i % 2 === 0 ? 'A' : 'B';
    const want = docs[label].pages;
    const { out, events } = await traced(cdp, async () => {
      const rec = page.evaluate(({ n, probeSrc }) => new Promise((resolve) => {
        const probe = new Function(`return (${probeSrc})()`);
        let downAt = null;
        window.addEventListener('pointerdown', () => { downAt = performance.now(); console.timeStamp('switch-down'); }, { capture: true, once: true });
        const t0 = performance.now();
        const tick = () => {
          if (downAt != null && probe() === n) {
            const at = performance.now();
            // The frame that shows the tab is painted after this rAF; mark
            // the next one so its style/layout are inside the window.
            requestAnimationFrame(() => { console.timeStamp('switch-shown'); resolve({ ms: at - downAt }); });
            return;
          }
          if (performance.now() - t0 > 10_000) { resolve({ ms: NaN }); return; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }), { n: want, probeSrc: visiblePages.toString() });
      await tabs.getByText(docs[label].docName, { exact: true }).click();
      const r = await rec;
      await sleep(300);
      return r;
    });
    const s = summarise(events, markUs(events, 'switch-down'), markUs(events, 'switch-shown'), stats?.[`to${label}`]);
    if (process.env.TRACE && label === 'A' && !fs.existsSync(process.env.TRACE)) fs.writeFileSync(process.env.TRACE, JSON.stringify({ traceEvents: events }));
    result[`to${label}`].push({ ms: out.ms, ...s });
    await waitQuiet(page, 1200);
  }
  await context.close();
  return result;
}

const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r0 = (v) => Math.round(v);

const env = readEnv();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const docs = await seed(admin);
const browser = await chromium.launch({ executablePath: exe });
const all = Object.fromEntries(BASES.map((b) => [b, []]));
const stats = STATS ? Object.fromEntries(BASES.map((b) => [b, { open: new Map(), toA: new Map(), toB: new Map() }])) : null;
try {
  if (!process.env.NO_WARMUP) for (const base of BASES) await oneRun(browser, base, docs, null).catch((e) => console.log('warm-up failed', e.message));
  for (let i = 0; i < RUNS; i += 1) {
    for (const base of BASES) {
      const r = await oneRun(browser, base, docs, stats?.[base]);
      all[base].push(r);
      const fmt = (xs) => xs.map((x) => `${r0(x.ms)}ms/style ${r0(x.style)}/${x.maxEls}els/layout ${r0(x.layout)}`).join(' ');
      console.log(base, `run ${i + 1}`, `elements=${r.elements}`, `open style=${r0(r.open.style)} layout=${r0(r.open.layout)} recalcs=${r.open.recalcs}`, '\n  toA', fmt(r.toA), '\n  toB', fmt(r.toB));
    }
  }
} finally {
  await browser.close();
  await cleanup(admin, docs);
}
for (const base of BASES) {
  const runs = all[base];
  const flat = (k) => runs.flatMap((r) => r[k]);
  const m = (xs, f) => r0(median(xs.map(f)));
  console.log('MEDIANS', base, JSON.stringify({
    elements: m(runs, (r) => r.elements),
    openStyle: m(runs, (r) => r.open.style), openLayout: m(runs, (r) => r.open.layout),
    toA_ms: m(flat('toA'), (x) => x.ms), toA_style: m(flat('toA'), (x) => x.style), toA_els: m(flat('toA'), (x) => x.maxEls), toA_layout: m(flat('toA'), (x) => x.layout),
    toB_ms: m(flat('toB'), (x) => x.ms), toB_style: m(flat('toB'), (x) => x.style), toB_els: m(flat('toB'), (x) => x.maxEls), toB_layout: m(flat('toB'), (x) => x.layout),
  }));
  if (stats) {
    for (const [phase, map] of Object.entries(stats[base])) {
      // One page's rules repeat per page and per tab: group them by shape.
      const grouped = new Map();
      let total = 0;
      for (const [sel, v] of map) {
        total += v.us;
        const key = sel.replace(/\[id="[^"]*_(pageDiv|annotationCanvas)_\d+"\]/g, '[id="<tab>_$1_<n>"]');
        const cur = grouped.get(key) || { us: 0, attempts: 0, matches: 0, n: 0 };
        cur.us += v.us; cur.attempts += v.attempts; cur.matches += v.matches; cur.n += 1;
        grouped.set(key, cur);
      }
      const perPage = [...grouped].filter(([k]) => k.includes('<tab>')).reduce((sum, [, v]) => sum + v.us, 0);
      console.log(`  selector stats ${phase}: all selectors ${r0(total / 1000)} ms, per-page [id=] rules ${r0(perPage / 1000)} ms`);
      const top = [...grouped].sort((a, b) => b[1].us - a[1].us).slice(0, 15);
      for (const [sel, v] of top) console.log(`    ${r0(v.us / 1000).toString().padStart(5)} ms  x${v.n}  attempts ${v.attempts}  matches ${v.matches}  ${sel.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
}
