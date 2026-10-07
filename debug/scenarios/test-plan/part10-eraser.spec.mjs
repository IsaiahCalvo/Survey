// TEST-PLAN Part 10 — Eraser (items 66, 67, 68), checked by the machine.
//
// Runs the real document path (document id, Y.Doc store, eraser lanes, the
// write-ahead log) against the in-memory fake backend — no network, no
// database. See tp-local-doc.mjs / tp-fake-backend.mjs.
//
//   66 [E1] Erase over old erasing: the owner's two real red strokes from
//      "Package 2" page 1, each carrying TWO eraser lanes from two earlier
//      sessions (tests/fixtures/package2-page1-two-lane-erase.json), are put
//      on the "server"; a third session erases across the old dab and wipe.
//   67 [E2] Tight curves: a tight pen scribble, erased across the middle.
//   68 [E3] Big ink: the largest imported drawing on package2-rev4.pdf
//      page 9 (1,520 imported marks on that page), erased across.
// Each checks the ink geometry against the exact answer (stroke minus every
// eraser sweep; same oracle as tests/eraserLaneCompositionRealData.test.mjs)
// in BOTH the window's own copy and the server's copy, plus a pixel check of
// the page before/after, plus how long the main thread was blocked.
//
// Not in CI. Run (the config starts Vite on that port; the checkout needs
// VITE_SUPABASE_URL/ANON_KEY in .env — the client is created but every call
// is answered in memory):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5481 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/part10-eraser.spec.mjs
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import {
  DESKTOP, OUT_DIR, centerMark, collectErrors, openViewer, pageFrame, prepareLocalContext, report, surface,
} from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import { compareWithExact, isDark, isRed, lanesFor, pixelDiff } from './tp-eraser-oracle.mjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 600_000 });

const FIXTURE = JSON.parse(await readFile(new URL('../../../tests/fixtures/package2-page1-two-lane-erase.json', import.meta.url), 'utf8'));

async function freshWindow(browser, backend, docId, pdf) {
  const context = await browser.newContext(DESKTOP);
  await prepareLocalContext(context, docId, { backend });
  // Long-task log (main thread blocked > 50 ms), read around each erase.
  await context.addInitScript(() => {
    window.__tpLongTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__tpLongTasks.push({ start: e.startTime, ms: e.duration });
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* not supported */ }
  });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await openViewer(page, pdf);
  return { context, page, errors };
}

async function armEraser(page) {
  const draw = page.getByRole('button', { name: 'Draw', exact: true }).first();
  if (await draw.getAttribute('aria-pressed') !== 'true') await draw.click();
  await page.getByRole('button', { name: 'Eraser', exact: true }).first().click();
  const partial = page.getByRole('button', { name: 'Partial erase', exact: true }).first();
  if (await partial.getAttribute('aria-pressed') !== 'true') await partial.click();
  await page.waitForTimeout(200);
}

async function armPen(page) {
  const draw = page.getByRole('button', { name: 'Draw', exact: true }).first();
  if (await draw.getAttribute('aria-pressed') !== 'true') await draw.click();
  await page.getByRole('button', { name: 'Pen', exact: true }).first().click();
  await page.waitForTimeout(200);
}

/** Drag through page-unit points on page n; returns the main-thread stall stats. */
async function gesture(page, n, pagePoints, { stepsPerSegment = 2 } = {}) {
  const frame = await pageFrame(page, n);
  const pts = pagePoints.map(([x, y]) => frame.toScreen(x, y));
  const t0 = await page.evaluate(() => performance.now());
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: stepsPerSegment });
  await page.mouse.up();
  return { frame, t0 };
}

async function stallsSince(page, t0) {
  return page.evaluate((since) => {
    const list = (window.__tpLongTasks || []).filter((t) => t.start >= since);
    return {
      count: list.length,
      longestMs: Math.round(Math.max(0, ...list.map((t) => t.ms))),
      totalMs: Math.round(list.reduce((s, t) => s + t.ms, 0)),
      // Every block over 100 ms: [ms after the gesture began, length ms].
      over100: list.filter((t) => t.ms > 100).map((t) => [Math.round(t.start - since), Math.round(t.ms)]),
    };
  }, t0);
}

const viewerObject = (page, id) => page.evaluate((key) => {
  const a = window.__phase35GetAnnotationById?.(key);
  return a ? JSON.parse(JSON.stringify(a)) : null;
}, id);

/**
 * Exactness of one erased mark in this window AND on the server, in page
 * units (outlines go through the app's own ink transform first).
 */
async function exactness(backend, base, shownWindow, shownServer, gestures) {
  const [basePath, windowPath, serverPath] = await backend.pagePaths([base, shownWindow, shownServer]);
  return {
    window: compareWithExact({ basePath, shownPath: windowPath, gestures }),
    server: compareWithExact({ basePath, shownPath: serverPath, gestures }),
  };
}

/** Wait until the server holds `count` eraser lanes for a mark. */
async function waitForLanes(backend, storageKey, count, timeout = 20_000) {
  const until = Date.now() + timeout;
  for (;;) {
    const { lanes: all } = await backend.serverState();
    const lanes = lanesFor(all, storageKey);
    if (lanes.length >= count || Date.now() > until) return lanes;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function serverObject(backend, storageKey) {
  const { byPage } = await backend.serverState();
  for (const page of Object.values(byPage)) {
    const found = (page.objects || []).find((o) => (o?.data?.id ?? o?.id) === storageKey);
    if (found) return found;
  }
  return null;
}

// Screen-px signed distance from a set of page-unit gestures.
const screenArea = (frame, gestures, clipBox) => (x, y) => {
  const px = { x: (x + clipBox.x - frame.box.x) / frame.scale, y: (y + clipBox.y - frame.box.y) / frame.scale };
  let best = Infinity;
  for (const g of gestures) {
    const pts = g.points;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[Math.min(i + 1, pts.length - 1)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((px.x - a.x) * dx + (px.y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, (Math.hypot(px.x - a.x - t * dx, px.y - a.y - t * dy) - g.radius) * frame.scale);
    }
  }
  return best;
};

test('66 [E1] erase over old erasing on the owner\'s real Package 2 strokes', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000066';
  const backend = new FakeBackend({ documentId: docId });
  const bases = Object.values(FIXTURE.marks).map((m) => m.base);
  const oldLanes = Object.assign({}, ...Object.values(FIXTURE.marks).map((m) => m.lanes));
  await backend.seedMarks({ 1: { objects: bases } }, oldLanes);
  const { context, page, errors } = await freshWindow(browser, backend, docId, 'Package 2 - Rev 4 -- IC.pdf');
  const KEY = '6a89a34c-3bb8-41cb-ab58-6e8702e9c165';
  const KEY2 = 'c0ae58b9-6c86-49cb-8b5c-3d7ded616ae6';
  await expect.poll(async () => Boolean(await viewerObject(page, KEY))).toBe(true);
  await armEraser(page);
  await page.mouse.move(5, 450);
  await page.waitForTimeout(300);
  const clip = await surface(page, 1).boundingBox();
  const before = await page.screenshot({ clip });
  await page.screenshot({ path: `${OUT_DIR}/66-before.png`, clip });
  // Through today's dab (174,188) and across the older session's wipe, then
  // on through the second stroke's old dab (175,332).
  const path = Array.from({ length: 41 }, (_, i) => [175 + 6 * Math.sin(i / 7), 112 + i * 6]);
  const { frame, t0 } = await gesture(page, 1, path);
  const lanes1 = await waitForLanes(backend, KEY, 3);
  const lanes2 = await waitForLanes(backend, KEY2, 3);
  await page.mouse.move(5, 450);
  await page.waitForTimeout(600);
  const after = await page.screenshot({ clip });
  await page.screenshot({ path: `${OUT_DIR}/66-after.png`, clip });
  const stalls = await stallsSince(page, t0);

  const results = {};
  for (const [key, lanes] of [[KEY, lanes1], [KEY2, lanes2]]) {
    const base = FIXTURE.marks[key].base;
    const gestures = lanes.flatMap((l) => l.gestures || []);
    // Residue an OLDER build left inside an old lane's own survivor may stay
    // (the real-data test allows it too); never more.
    const allowed = Math.max(...Object.values(FIXTURE.marks[key].lanes).map((l) => compareWithExact({ basePath: base.path, shownPath: l.survivor.path, gestures: l.gestures }).missingOutsideEraserArea));
    const shownWindow = await viewerObject(page, key);
    const shownServer = await serverObject(backend, key);
    results[key.slice(0, 8)] = {
      lanes: lanes.length,
      allowedMissing: allowed,
      ...(await exactness(backend, base, shownWindow, shownServer, gestures)),
    };
  }
  const allGestures = [...lanes1, ...lanes2].flatMap((l) => l.gestures || []);
  const pixels = pixelDiff(before, after, { inArea: screenArea(frame, allGestures, clip), ink: isRed });
  const ok = Object.values(results).every((r) => r.lanes >= 3
    && r.window.paintedInsideEraserArea === 0 && r.server.paintedInsideEraserArea === 0
    && r.window.missingOutsideEraserArea <= r.allowedMissing + 0.5 && r.server.missingOutsideEraserArea <= r.allowedMissing + 0.5)
    && pixels.inkInsideAfter === 0 && pixels.lostOutside <= 4 && pixels.addedOutside <= 4 && pixels.removed > 50
    && errors.length === 0;
  report('66', ok ? 'PASS' : 'FAIL', `${JSON.stringify(results)} pixels=${JSON.stringify(pixels)} stalls=${JSON.stringify(stalls)} db=${backend.writes()} fake writes errors=${errors.length} shots=66-before.png/66-after.png`);
  await context.close();
  expect(errors).toEqual([]);
  expect(ok).toBe(true);
});

test('67 [E2] tight scribble keeps its round tips, app stays responsive', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000067';
  const backend = new FakeBackend({ documentId: docId });
  const { context, page, errors } = await freshWindow(browser, backend, docId, 'Package 2 - Rev 4 -- IC.pdf');
  await armPen(page);
  // A tight scribble: 26 loops of radius 5 page units, drifting right.
  const scribble = Array.from({ length: 26 * 16 + 1 }, (_, i) => {
    const t = (i / 16) * Math.PI * 2;
    return [120 + i * 0.55 + 5 * Math.cos(t), 640 + 5 * Math.sin(t) + 3 * Math.sin(i / 40)];
  });
  await gesture(page, 1, scribble, { stepsPerSegment: 1 });
  let id = null;
  await expect.poll(async () => {
    const { byPage } = await backend.serverState();
    const ink = (byPage[1]?.objects || []).filter((o) => o?.type === 'path');
    id = ink[0]?.data?.id ?? ink[0]?.id ?? null;
    return id;
  }, { timeout: 20_000 }).not.toBeNull();
  const baseServer = await serverObject(backend, id);
  await armEraser(page);
  await page.mouse.move(5, 450);
  await page.waitForTimeout(300);
  const clip = await surface(page, 1).boundingBox();
  const before = await page.screenshot({ clip });
  await page.screenshot({ path: `${OUT_DIR}/67-before.png`, clip });
  // Erase across the middle third (a gentle S, not a straight line).
  const wipe = Array.from({ length: 21 }, (_, i) => [175 + i * 4, 618 + i * 2.2 + 4 * Math.sin(i / 3)]);
  const tStart = Date.now();
  const { frame, t0 } = await gesture(page, 1, wipe);
  const tUp = Date.now();
  const lanes = await waitForLanes(backend, id, 1);
  const tCommitted = Date.now();
  await page.mouse.move(5, 450);
  await page.waitForTimeout(600);
  const after = await page.screenshot({ clip });
  await page.screenshot({ path: `${OUT_DIR}/67-after.png`, clip });
  const stalls = await stallsSince(page, t0);
  const gestures = lanes.flatMap((l) => l.gestures || []);
  const shownWindow = await viewerObject(page, id);
  const shownServer = await serverObject(backend, id);
  const geo = await exactness(backend, baseServer, shownWindow, shownServer, gestures);
  const pixels = pixelDiff(before, after, { inArea: screenArea(frame, gestures, clip), ink: isRed });
  const timing = { dragMs: tUp - tStart, upToSavedMs: tCommitted - tUp, ...stalls };
  const ok = lanes.length >= 1 && geo.window.paintedInsideEraserArea === 0 && geo.server.paintedInsideEraserArea === 0
    && geo.window.missingOutsideEraserArea <= 0.5 && geo.server.missingOutsideEraserArea <= 0.5
    && pixels.inkInsideAfter === 0 && pixels.lostOutside <= 4 && pixels.addedOutside <= 4 && pixels.removed > 30
    && stalls.longestMs < 2000 && errors.length === 0;
  report('67', ok ? 'PASS' : 'FAIL', `geo=${JSON.stringify(geo)} pixels=${JSON.stringify(pixels)} timing=${JSON.stringify(timing)} errors=${errors.length} shots=67-before.png/67-after.png`);
  await context.close();
  expect(errors).toEqual([]);
  expect(ok).toBe(true);
});


const boundsOf = (path) => {
  const xs = []; const ys = [];
  for (const c of path || []) for (let i = 1; i + 1 < c.length; i += 2) { xs.push(c[i]); ys.push(c[i + 1]); }
  return xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) } : null;
};

/** Erase across one mark (a gentle S through its middle) and measure it. */
async function eraseAcross(page, backend, errors, pageNo, target, tag) {
  const id = target.data?.id ?? target.id;
  const [pagePath] = await backend.pagePaths([target]);
  const bb = boundsOf(pagePath);
  await centerMark(page, id);
  await armEraser(page);
  await page.mouse.move(5, 450);
  await page.waitForTimeout(500);
  const clip = await surface(page, pageNo).boundingBox();
  const visibleClip = { x: Math.max(clip.x, 0), y: Math.max(clip.y, 0) };
  visibleClip.width = Math.min(clip.x + clip.width, 1440) - visibleClip.x;
  visibleClip.height = Math.min(clip.y + clip.height, 900) - visibleClip.y;
  const before = await page.screenshot({ clip: visibleClip });
  await page.screenshot({ path: `${OUT_DIR}/68-${tag}-before.png`, clip: visibleClip });
  const cx = (bb.x0 + bb.x1) / 2;
  const span = bb.y1 - bb.y0;
  const wipe = Array.from({ length: 31 }, (_, i) => [cx + Math.min(12, (bb.x1 - bb.x0) / 6) * Math.sin(i / 4), bb.y0 - 6 + (span + 12) * (i / 30)]);
  // TP_CPUPROFILE=1: also save a CPU profile of the erase (OUT_DIR/68-<tag>.cpuprofile).
  const cdp = process.env.TP_CPUPROFILE ? await page.context().newCDPSession(page) : null;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
  const tDown = Date.now();
  const { frame, t0 } = await gesture(page, pageNo, wipe);
  const tUp = Date.now();
  const lanes = await waitForLanes(backend, id, 1, 30_000);
  const tSaved = Date.now();
  await page.mouse.move(5, 450);
  await page.waitForTimeout(800);
  const after = await page.screenshot({ clip: visibleClip });
  await page.screenshot({ path: `${OUT_DIR}/68-${tag}-after.png`, clip: visibleClip });
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    await writeFile(`${OUT_DIR}/68-${tag}.cpuprofile`, JSON.stringify(profile));
    await cdp.detach();
  }
  const stalls = await stallsSince(page, t0);
  const gestures = lanes.flatMap((l) => l.gestures || []);
  // TP_DUMP=1: keep the mark, its lanes and the whole server page set for offline benchmarks.
  if (process.env.TP_DUMP) {
    const { byPage } = await backend.serverState();
    await writeFile(`${OUT_DIR}/68-${tag}-dump.json`, JSON.stringify({ target, lanes, byPage }));
  }
  const geo = await exactness(backend, target, await viewerObject(page, id), await serverObject(backend, id), gestures);
  const pixels = pixelDiff(before, after, { inArea: screenArea(frame, gestures, visibleClip), ink: isDark });
  const timing = { dragMs: tUp - tDown, upToSavedMs: tSaved - tUp, ...stalls };
  // Curved (imported) outlines are flattened to polygons when first bitten, at
  // the app's 0.05 pt curve tolerance: allow that much area along the outline
  // (it is spread along the edge, not a block).
  const curved = target.path.some((c) => c[0] === 'C' || c[0] === 'Q');
  const tol = curved ? 3 : 0.5;
  // Thin imported lines drew 10-30% lighter after a bite until 2026-10-06
  // (the survivor clipped the source curve on its own edge: anti-aliased
  // twice). The rest of the line must keep its weight (within 5%).
  const ok = lanes.length >= 1 && geo.window.paintedInsideEraserArea <= (curved ? tol : 0) && geo.server.paintedInsideEraserArea <= (curved ? tol : 0)
    && geo.window.missingOutsideEraserArea <= tol && geo.server.missingOutsideEraserArea <= tol
    && pixels.removed > 20 && pixels.lostOutside <= (curved ? 12 : 4)
    && pixels.inkWeightKeptOutside >= 0.95 && pixels.inkWeightKeptOutside <= 1.05
    // "a long pause": was 9.9 s on the detailed stroke before 9e4043d, ~1.5 s
    // before 2026-10-06 (whole-document clones in the erase commit).
    && stalls.longestMs < 3000 && errors.length === 0;
  return { ok, summary: `${tag}: ${String(id).slice(0, 24)} cmds=${target.path.length} box=${Math.round(bb.x1 - bb.x0)}x${Math.round(bb.y1 - bb.y0)}pt geo=${JSON.stringify(geo)} pixels=${JSON.stringify(pixels)} timing=${JSON.stringify(timing)}` };
}

test('68 [E3] erase across big imported / detailed ink: quick and exact', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000068';
  const backend = new FakeBackend({ documentId: docId });
  const { context, page, errors } = await freshWindow(browser, backend, docId, 'package2-rev4.pdf');
  // (a) The biggest imported drawing in the file (package2-rev4.pdf carries
  // 3,049 imported ink marks; the largest is on page 8, among 393 others).
  let all = [];
  await expect.poll(async () => {
    const { byPage } = await backend.serverState();
    all = Object.entries(byPage).flatMap(([pg, p]) => (p.objects || []).filter((o) => o?.isPdfImported && o?.type === 'path').map((o) => ({ pg: Number(pg), o })));
    return all.length;
  }, { timeout: 120_000 }).toBeGreaterThan(3000);
  const paths = await backend.pagePaths(all.map((a) => a.o));
  let best = 0;
  const area = (i) => { const b = boundsOf(paths[i]); return b ? (b.x1 - b.x0) * (b.y1 - b.y0) : 0; };
  for (let i = 1; i < all.length; i += 1) if (area(i) > area(best)) best = i;
  const imported = all[best];
  await page.evaluate((n) => window.__navigateToPage?.(n), imported.pg);
  await page.waitForTimeout(2500);
  await expect.poll(async () => Boolean(await viewerObject(page, imported.o.data?.id ?? imported.o.id)), { timeout: 30_000 }).toBe(true);
  const a = await eraseAcross(page, backend, errors, imported.pg, imported.o, 'imported');

  // (b) Huge, very detailed ink: one 1,600-point pen drawing (a dense spiral
  // scribble ~430 x 280 pt) on page 1, erased across the middle.
  await page.evaluate(() => window.__navigateToPage?.(1));
  await page.waitForTimeout(2000);
  await armPen(page);
  const scribble = Array.from({ length: 1600 }, (_, i) => {
    const t = i / 1600;
    return [90 + 430 * t + 18 * Math.cos(i / 2.2), 470 + 120 * Math.sin(t * Math.PI * 6) + 18 * Math.sin(i / 2.2)];
  });
  const before1 = new Set(((await backend.serverState()).byPage[1]?.objects || []).map((o) => o?.data?.id ?? o?.id));
  await gesture(page, 1, scribble, { stepsPerSegment: 1 });
  let drawn = null;
  await expect.poll(async () => {
    const objs = (await backend.serverState()).byPage[1]?.objects || [];
    drawn = objs.find((o) => o?.type === 'path' && !before1.has(o?.data?.id ?? o?.id)) || null;
    return Boolean(drawn);
  }, { timeout: 30_000 }).toBe(true);
  const b = await eraseAcross(page, backend, errors, 1, drawn, 'detailed');

  const ok = a.ok && b.ok;
  report('68', ok ? 'PASS' : 'FAIL', `${a.summary} | ${b.summary} | errors=${errors.length} shots=68-imported-*.png 68-detailed-*.png`);
  await context.close();
  expect(errors).toEqual([]);
  expect(ok).toBe(true);
});
