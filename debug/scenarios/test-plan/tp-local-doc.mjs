// Shared helpers for the TEST-PLAN Part 9–12 walkthroughs (items 66–80).
//
// WHY a "local document": the plain no-cloud route (?testPdf=…) opens a bare
// File with no id, so the per-document Y.Doc (YDocProvider), the CRDT undo
// manager, eraser lanes and the History panel are all switched OFF there —
// it would test the wrong code. Production documents always have an id. So
// these helpers stamp an id on the test file before the app opens it
// (`window.__devTestPdf` is the dev-only hand-off in DevTestRoute/AppShell).
// With an id the app runs its real document path: Y.Doc + IndexedDB, the
// per-user undo manager, History (device copy in localStorage), and two pages
// in ONE browser context share edits over the app's own BroadcastChannel
// (src/lib/collab/ydocLifecycle.js) — the local stand-in for two windows.
//
// No database traffic: every request that is not to the local dev server is
// aborted and every WebSocket (Supabase Realtime) is closed before it opens.
// The dev server must have VITE_SUPABASE_URL/ANON_KEY set (the main checkout's
// .env): YDocProvider reads `supabase.channel` unguarded and crashes on a
// client-less build. The client exists but can never reach the network.

import { record } from './lib.mjs';

export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
export const DESKTOP = { viewport: { width: 1440, height: 900 } };
export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA };
// WebKit (the iOS Safari engine) does not take isMobile.
export const PHONE_WEBKIT = { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA };

export const OUT_DIR = process.env.TP_OUT
  || '/tmp/claude-0/-home-user-Survey/9b0de99e-8c5f-5afb-8f1e-4b0f6be9fab7/scratchpad/autotest2';

export const baseUrl = () => (process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');

// cloudLibrary: the app's library reads (documents, projects, templates)
// stay on and go to the FakeBackend (supabaseClient.js devCloudLibrary).
export function viewerUrl(pdf, { phone = false, cloudLibrary = false } = {}) {
  return `${baseUrl()}/?testPdf=${encodeURIComponent(pdf)}&surveyTemplateWorkflowE2E=1${phone ? '&mobileNav=tabs&nativeShell=expo' : ''}${cloudLibrary ? '&devCloudLibrary=1' : ''}`;
}

/**
 * Block every non-local request/WebSocket and stamp `docId` on the test PDF.
 * With `backend` (a FakeBackend from tp-fake-backend.mjs) the Supabase calls
 * are answered in memory instead of failing.
 */
export async function prepareLocalContext(context, docId, { backend = null, user = null } = {}) {
  const local = new URL(baseUrl());
  const isLocal = (url) => {
    try { const u = new URL(url); return u.hostname === local.hostname && u.port === local.port; } catch { return false; }
  };
  await context.route((url) => !isLocal(url.href), (route) => route.abort());
  if (typeof context.routeWebSocket === 'function') {
    await context.routeWebSocket((url) => !isLocal(url.href), (ws) => ws.close());
  }
  if (backend) await backend.attach(context, { userId: user?.id || null });
  // A second person (DevTestRoute reads window.__devTestUser before the app
  // mounts); the document stays owned by 'dev-test-user'.
  if (user) await context.addInitScript((u) => { window.__devTestUser = u; }, user);
  // Keep the full stack of every console.error (a render loop's stack names
  // the component; the console message alone is cut short).
  await context.addInitScript(() => {
    window.__tpConsoleErrors = [];
    const original = console.error;
    console.error = (...args) => {
      try {
        window.__tpConsoleErrors.push(args.map((a) => (a && a.stack) ? `${a.message}\n${a.stack}` : (typeof a === 'object' ? JSON.stringify(a)?.slice(0, 4000) : String(a))).join(' | ').slice(0, 12000));
        if (window.__tpConsoleErrors.length > 50) window.__tpConsoleErrors.shift();
      } catch { /* keep logging */ }
      return original.apply(console, args);
    };
  });
  await context.addInitScript((id) => {
    let held = null;
    Object.defineProperty(window, '__devTestPdf', {
      configurable: true,
      get() { return held; },
      set(file) {
        if (file && id) {
          // A document opened from Home is its row: id + owner (user_id). The
          // owner is the dev route's signed-in user ('dev-test-user').
          try {
            Object.defineProperty(file, 'id', { value: id, configurable: true });
            Object.defineProperty(file, 'user_id', { value: 'dev-test-user', configurable: true });
          } catch { /* keep going */ }
        }
        held = file;
      },
    });
  }, docId);
}

export async function openViewer(page, pdf, { phone = false, settle = 2500, cloudLibrary = false } = {}) {
  await page.goto(viewerUrl(pdf, { phone, cloudLibrary }));
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => typeof window.__ydocAnnotationCount === 'number', null, { timeout: 30_000 });
  await page.waitForTimeout(settle);
}

export const surface = (page, n = 1) => page.locator(`.survey-pdfjs-page-div[data-page-number="${n}"]`).first();

/** Page-unit (PDF point) → screen transform for page n, container-measured. */
export async function pageFrame(page, n = 1) {
  const box = await surface(page, n).boundingBox();
  const size = await page.evaluate((num) => {
    const el = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${num}"]`);
    const svg = el?.querySelector('[data-svg-annotation-layer="1"]') || el?.querySelector('svg[viewBox]');
    const vb = svg?.getAttribute('viewBox')?.split(/\s+/).map(Number);
    return vb && vb.length === 4 ? { w: vb[2], h: vb[3] } : null;
  }, n);
  const scale = size ? box.width / size.w : 1;
  return { box, scale, size, toScreen: (x, y) => [box.x + x * scale, box.y + y * scale] };
}

export async function stored(page) {
  return page.evaluate(() => Array.from(
    document.querySelectorAll('[data-svg-annotation-layer="1"] g[data-anno-id]'),
    (g) => {
      const id = g.getAttribute('data-anno-id');
      const a = window.__phase35GetAnnotationById?.(id) || null;
      const r = g.getBoundingClientRect();
      return { id, page: Number(g.closest('[data-page-number]')?.getAttribute('data-page-number')), type: a?.type || null, fill: a?.fill ?? null, stroke: a?.stroke ?? null, left: a?.left ?? null, top: a?.top ?? null, locked: a?.locked ?? a?.data?.locked ?? null, imported: Boolean(a?.isPdfImported), rect: [r.x, r.y, r.width, r.height] };
    },
  ));
}

export async function pickTool(page, group, tool) {
  if (group) {
    const g = page.getByRole('button', { name: group, exact: true }).first();
    if (await g.getAttribute('aria-pressed') !== 'true') await g.click();
  }
  if (tool) await page.getByRole('button', { name: tool, exact: true }).first().click();
  await page.waitForTimeout(150);
}

export async function drag(page, points, { steps = 2 } = {}) {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps });
  await page.mouse.up();
}

export async function setWidth(page, value) {
  const width = page.getByRole('textbox', { name: /^(Width|Size)$/ }).first();
  if (await width.isVisible().catch(() => false)) {
    await width.fill(String(value));
    await width.press('Tab');
  }
}

/** Scroll the viewer so the mark with this id sits in the middle of the screen. */
export async function centerMark(page, id) {
  await page.evaluate((key) => {
    const g = document.querySelector(`[data-anno-id="${CSS.escape(key)}"]`);
    if (!g) return;
    let scroller = g.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    if (!scroller) return;
    const r = g.getBoundingClientRect();
    scroller.scrollTop += (r.top + r.height / 2) - innerHeight / 2;
    scroller.scrollLeft += (r.left + r.width / 2) - innerWidth / 2;
  }, id);
  await page.waitForTimeout(800);
}

/** Live Y.Doc for this document, through the dev server's own module graph. */
export async function withDoc(page, docId, fn, arg) {
  return page.evaluate(async ({ docId: id, src, arg: a }) => {
    const registry = await import('/src/lib/collab/ydocRegistry.js');
    const store = await import('/src/services/annotationDocStore.js');
    const doc = registry.getOrCreateYDoc(id);
    registry.releaseYDoc(id);
    // eslint-disable-next-line no-new-func
    return new Function('doc', 'store', 'arg', `return (${src})(doc, store, arg);`)(doc, store, a);
  }, { docId, src: fn.toString(), arg });
}

export async function screenshotTo(page, name, opts = {}) {
  const path = `${OUT_DIR}/${name}.png`;
  await page.screenshot({ path, ...opts });
  return path;
}

export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e).split('\n')[0].slice(0, 200)));
  // A render crash caught by the app's ErrorBoundary never reaches pageerror.
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && /ErrorBoundary caught|Maximum update depth/.test(text)) errors.push(`console: ${text.slice(0, 300)}`);
  });
  return errors;
}

/**
 * Print one result line and file it with the shared table
 * (node debug/scenarios/test-plan/summary.mjs prints every item's verdict).
 */
export function report(item, result, evidence, variant = 'desktop-local-backend') {
  // eslint-disable-next-line no-console
  console.log(`[TEST-PLAN ${item}] ${result} — ${evidence}`);
  record(item, variant, result, evidence);
}
