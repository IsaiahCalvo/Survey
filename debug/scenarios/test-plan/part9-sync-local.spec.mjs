// TEST-PLAN Part 9 — Two windows (sync), items 59–63, on the LOCAL backend.
//
// part9-sync.spec.mjs (another helper) marks 59–64 NEEDS-BACKEND: the plain
// fake-data route has no document id and no live channel. This file runs
// them anyway with two browser contexts (two "windows", same test user)
// against tp-fake-backend.mjs: an in-memory Supabase stand-in inside the
// Playwright process that answers the app's REST calls and relays its
// Realtime traffic (broadcast + postgres_changes) between the windows. The
// app code under test is the real one (document store, write-ahead log, live
// strokes / live edits, survey-marker sync). What it does NOT cover: the real
// Supabase Realtime service, its policies and network latency between
// devices. No network, no database. 64 (a second account) is not covered.
// Run (not in CI; .env needs VITE_SUPABASE_URL/KEY so the client exists):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5484 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/part9-sync-local.spec.mjs
import { test, expect } from '@playwright/test';
import { OUT_DIR, pageFrame, report } from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import {
  drawRect, openWindow, pickMark, selectTool, serverMarks, setStrokeColor, tool, waitFor, windowMarks,
} from './tp-actions.mjs';
import { TEMPLATES, enterSurvey, placeMarker, surveyMarkers } from './lib.mjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 300_000 });

const PDF = 'Package 2 - Rev 4 -- IC.pdf';
const WIN = { device: { viewport: { width: 1200, height: 900 } } };
const VARIANT = 'two-windows-local-backend';

async function twoWindows(browser, docId, opts = {}) {
  const backend = new FakeBackend({ documentId: docId });
  const A = await openWindow(browser, backend, docId, PDF, { ...WIN, ...opts });
  const B = await openWindow(browser, backend, docId, PDF, { ...WIN, ...opts });
  return { backend, A, B };
}

const closeAll = async (...ws) => { for (const w of ws) await w.context.close(); };

test('59 [Y2] live drawing: ghost ink in B while A draws, real stroke right after', async ({ browser }) => {
  const { backend, A, B } = await twoWindows(browser, '7e57d0c0-0000-4000-8000-000000000059');
  await tool(A.page, 'Draw', 'Pen');
  const frame = await pageFrame(A.page, 1);
  const pts = Array.from({ length: 40 }, (_, i) => frame.toScreen(120 + i * 8, 640 + 20 * Math.sin(i / 5)));
  const t0 = Date.now();
  let firstGhostMs = null;
  let maxGhostPoints = 0;
  let drawing = true;
  const watch = (async () => {
    while (drawing) {
      const g = await B.page.evaluate(() => [...document.querySelectorAll('[data-live-stroke-ghost="true"]')].map((e) => Number(e.getAttribute('data-live-stroke-points')) || 0));
      if (g.length && firstGhostMs == null) firstGhostMs = Date.now() - t0;
      maxGhostPoints = Math.max(maxGhostPoints, ...g, 0);
      await new Promise((r) => setTimeout(r, 60));
    }
  })();
  await A.page.mouse.move(pts[0][0], pts[0][1]);
  await A.page.mouse.down();
  for (const [x, y] of pts.slice(1)) { await A.page.mouse.move(x, y, { steps: 2 }); await A.page.waitForTimeout(45); }
  await B.page.screenshot({ path: `${OUT_DIR}/59-B-while-A-draws.png` });
  const drawMs = Date.now() - t0;
  await A.page.mouse.up();
  const tUp = Date.now();
  drawing = false;
  await watch;
  const landed = await waitFor(async () => (await windowMarks(B.page)).find((m) => m.type === 'path'), { timeout: 10_000, every: 50 });
  const landMs = Date.now() - tUp;
  const ghostsLeft = await waitFor(async () => (await B.page.locator('[data-live-stroke-ghost="true"]').count()) === 0, { timeout: 5000 });
  await B.page.screenshot({ path: `${OUT_DIR}/59-B-landed.png` });
  const ok = firstGhostMs != null && firstGhostMs < drawMs && maxGhostPoints > 5 && Boolean(landed) && landMs < 3000 && ghostsLeft
    && A.errors.length + B.errors.length === 0;
  report(59, ok ? 'PASS' : 'FAIL', `A drew for ${drawMs} ms; B showed ghost ink after ${firstGhostMs} ms (up to ${maxGhostPoints} points while drawing); real stroke in B ${landMs} ms after A let go; ghost cleared=${ghostsLeft}; shots=59-B-while-A-draws.png/59-B-landed.png`, VARIANT);
  await closeAll(A, B);
  expect(ok).toBe(true);
});

test('60 [Y2] live moves: B sees A\'s drag within a moment', async ({ browser }) => {
  const { backend, A, B } = await twoWindows(browser, '7e57d0c0-0000-4000-8000-000000000060');
  await drawRect(A.page, 1, 100, 600, 220, 680);
  const r0 = await waitFor(async () => (await windowMarks(B.page))[0], { timeout: 15_000 });
  const grab = await pickMark(A.page, r0.id);
  const sx = grab.x + grab.w * 0.3;
  let midDragLeft = null;
  await A.page.mouse.move(sx, grab.y);
  await A.page.mouse.down();
  for (let k = 1; k <= 12; k += 1) {
    await A.page.mouse.move(sx + k * 6, grab.y, { steps: 2 });
    await A.page.waitForTimeout(60);
    if (k === 9) midDragLeft = await B.page.evaluate((id) => document.querySelector(`[data-anno-id="${CSS.escape(id)}"]`)?.getBoundingClientRect().left, r0.id);
  }
  const startLeftPx = grab.x;
  await A.page.mouse.up();
  const tUp = Date.now();
  const target = (await waitFor(async () => { const m = (await windowMarks(A.page))[0]; return m && m.left > r0.left + 5 ? m : null; }, { timeout: 5000 })) || {};
  const seen = await waitFor(async () => { const m = (await windowMarks(B.page))[0]; return m && Math.abs(m.left - target.left) < 0.75 ? m : null; }, { timeout: 10_000, every: 50 });
  const lagMs = Date.now() - tUp;
  await B.page.screenshot({ path: `${OUT_DIR}/60-B-after-move.png` });
  const movedDuringDrag = midDragLeft != null && midDragLeft > startLeftPx + 5;
  const ok = Boolean(seen) && lagMs < 2000 && A.errors.length + B.errors.length === 0;
  report(60, ok ? 'PASS' : 'FAIL', `A moved the rectangle ${r0.left} -> ${target.left}; B had it there ${lagMs} ms after A let go; B already showed it moving mid-drag=${movedDuringDrag}; shot=60-B-after-move.png`, VARIANT);
  await closeAll(A, B);
  expect(ok).toBe(true);
});

test('61 [Y1] two edits to one mark at once: colour from A and spot from B both stay', async ({ browser }) => {
  const { backend, A, B } = await twoWindows(browser, '7e57d0c0-0000-4000-8000-000000000061');
  await drawRect(A.page, 1, 100, 600, 220, 680);
  const r0 = await waitFor(async () => (await windowMarks(B.page))[0], { timeout: 15_000 });
  await pickMark(A.page, r0.id);
  const grab = await pickMark(B.page, r0.id);
  // At about the same time: A recolours, B drags.
  const sx = grab.x + grab.w * 0.3;
  await Promise.all([
    setStrokeColor(A.page, '#0000FF'),
    (async () => {
      await B.page.mouse.move(sx, grab.y);
      await B.page.mouse.down();
      for (let k = 1; k <= 8; k += 1) await B.page.mouse.move(sx + k * 8, grab.y, { steps: 2 });
      await B.page.mouse.up();
    })(),
  ]);
  const end = await waitFor(async () => {
    const [a, b, s] = [(await windowMarks(A.page))[0], (await windowMarks(B.page))[0], (await serverMarks(backend))[0]];
    const good = (m) => m && m.stroke === 'rgba(0, 0, 255, 1)' && m.left > r0.left + 5;
    return good(a) && good(b) && good(s) && Math.abs(a.left - b.left) < 0.75 && Math.abs(a.left - s.left) < 0.75 ? { a, b, s } : null;
  }, { timeout: 12_000 });
  const fin = end || { a: (await windowMarks(A.page))[0], b: (await windowMarks(B.page))[0], s: (await serverMarks(backend))[0] };
  await A.page.screenshot({ path: `${OUT_DIR}/61-A-end.png` });
  await B.page.screenshot({ path: `${OUT_DIR}/61-B-end.png` });
  const ok = Boolean(end) && A.errors.length + B.errors.length === 0;
  report(61, ok ? 'PASS' : 'FAIL', `start ${r0.stroke}@${r0.left}; end A ${fin.a?.stroke}@${fin.a?.left}, B ${fin.b?.stroke}@${fin.b?.left}, server ${fin.s?.stroke}@${fin.s?.left} (want blue + moved in all three); shots=61-A-end.png/61-B-end.png`, VARIANT);
  await closeAll(A, B);
  expect(ok).toBe(true);
});

test('62 [Y3] Survey Markers live: B sees A\'s move within about half a second', async ({ browser }) => {
  const { backend, A, B } = await twoWindows(browser, '7e57d0c0-0000-4000-8000-000000000062', { templates: TEMPLATES });
  await enterSurvey(A.page);
  await enterSurvey(B.page);
  await placeMarker(A.page, 200, 640, 240, 680);
  const m0 = await waitFor(async () => (await surveyMarkers(B.page))[0], { timeout: 15_000 });
  const a0 = (await surveyMarkers(A.page))[0];
  // Pick it with a box around it (as part8's item 55 does), then drag it.
  await A.page.evaluate(() => document.activeElement?.blur?.());
  // (the toolbar button, not the V key: a just-placed marker's name field
  // may still hold the keyboard and would get a "v" typed into it)
  await A.page.mouse.click(5, 450);
  await selectTool(A.page);
  await A.page.mouse.move(a0.x - 45, a0.y - 45);
  await A.page.mouse.down();
  await A.page.mouse.move(a0.x + 45, a0.y + 45, { steps: 8 });
  await A.page.mouse.up();
  await A.page.waitForTimeout(500);
  await A.page.mouse.move(a0.x, a0.y);
  await A.page.mouse.down();
  for (let k = 1; k <= 8; k += 1) await A.page.mouse.move(a0.x + k * 8, a0.y, { steps: 2 });
  await A.page.mouse.up();
  const tUp = Date.now();
  const aEnd = await waitFor(async () => { const m = (await surveyMarkers(A.page))[0]; return m && m.x > a0.x + 20 ? m : null; }, { timeout: 5000 });
  const seen = await waitFor(async () => { const m = (await surveyMarkers(B.page))[0]; return m && aEnd && Math.abs(m.x - aEnd.x) <= 2 ? m : null; }, { timeout: 10_000, every: 40 });
  const lagMs = Date.now() - tUp;
  await B.page.screenshot({ path: `${OUT_DIR}/62-B-after-move.png` });
  const ok = Boolean(m0) && Boolean(aEnd) && Boolean(seen) && lagMs <= 1000 && A.errors.length + B.errors.length === 0;
  report(62, ok ? 'PASS' : 'FAIL', `marker placed in A appeared in B=${Boolean(m0)}; A moved it ${a0?.x} -> ${aEnd?.x}px; B showed the new spot ${lagMs} ms after A let go (plan: about 500 ms; this 4-core box was loaded); shot=62-B-after-move.png`, VARIANT);
  await closeAll(A, B);
  expect(ok).toBe(true);
});

test('63 [M15] Delete stays on your mark while the other window deletes another', async ({ browser }) => {
  const { backend, A, B } = await twoWindows(browser, '7e57d0c0-0000-4000-8000-000000000063');
  await drawRect(A.page, 1, 60, 600, 150, 680); // 1
  await drawRect(A.page, 1, 200, 600, 290, 680); // 2
  await drawRect(A.page, 1, 340, 600, 430, 680); // 3 (must survive)
  const ids = await waitFor(async () => { const m = await windowMarks(B.page); return m.length === 3 ? m.sort((x, y) => x.left - y.left).map((x) => x.id) : null; }, { timeout: 20_000 });
  const [r1, r2, r3] = ids;
  await pickMark(A.page, r2);
  await pickMark(B.page, r1);
  await B.page.keyboard.press('Delete');
  const goneInA = await waitFor(async () => !(await windowMarks(A.page)).some((m) => m.id === r1), { timeout: 10_000 });
  await A.page.keyboard.press('Delete');
  const end = await waitFor(async () => {
    const [a, b, s] = [await windowMarks(A.page), await windowMarks(B.page), await serverMarks(backend)];
    const only3 = (list) => list.length === 1 && list[0].id === r3;
    return only3(a) && only3(b) && only3(s) ? true : null;
  }, { timeout: 10_000 });
  const [a, b, s] = [await windowMarks(A.page), await windowMarks(B.page), await serverMarks(backend)];
  await A.page.screenshot({ path: `${OUT_DIR}/63-A-end.png` });
  const ok = Boolean(goneInA) && Boolean(end) && A.errors.length + B.errors.length === 0;
  report(63, ok ? 'PASS' : 'FAIL', `errors A=${JSON.stringify(A.errors).slice(0, 600)} B=${JSON.stringify(B.errors).slice(0, 300)}; B deleted rect 1 (A saw it go=${Boolean(goneInA)}); A's Delete with rect 2 picked -> left on page A [${a.map((m) => ids.indexOf(m.id) + 1)}], B [${b.map((m) => ids.indexOf(m.id) + 1)}], server [${s.map((m) => ids.indexOf(m.id) + 1)}] (want only 3); shot=63-A-end.png`, VARIANT);
  await closeAll(A, B);
  expect(ok).toBe(true);
});
