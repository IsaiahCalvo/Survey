// TEST-PLAN Part 11 — Undo and Redo (items 69–72), checked by the machine.
//
// Real document path (document id, store, write-ahead log) against the
// in-memory fake backend; 71 uses two browser contexts as the two windows,
// live-synced through the fake Realtime relay. No network, no database.
//   69 [R1] draw A, undo, draw B -> Redo greyed, A never comes back
//   70 [R1] callout: create, type, click away, ONE Cmd/Ctrl+Z removes it all
//   71 [R2] A recolours a rectangle, B moves it, A undoes -> colour back,
//           new spot kept (in both windows and on the server)
//   72 [R3] a PDF with its own markup: draw one stroke, undo -> only the
//           stroke goes; the PDF's markup is unchanged and not undoable
// Run (not in CI; the config starts Vite; .env needs VITE_SUPABASE_URL/KEY):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5482 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/part11-undo.spec.mjs
import { test, expect } from '@playwright/test';
import { OUT_DIR, report } from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import {
  buttonEnabled, clickPage, drawPen, drawRect, dragPage, openWindow, pickAt, redo, selectTool,
  serverMarks, setStrokeColor, tool, undo, waitFor, windowMarks,
} from './tp-actions.mjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 300_000 });

const PDF = 'Package 2 - Rev 4 -- IC.pdf';
const near = (a, b, tol = 0.75) => Math.abs(Number(a) - Number(b)) <= tol;

test('69 [R1] one timeline: a new action clears Redo', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000069';
  const backend = new FakeBackend({ documentId: docId });
  const { context, page, errors } = await openWindow(browser, backend, docId, PDF);
  await drawRect(page, 1, 80, 600, 180, 660); // A
  const a = await waitFor(async () => (await windowMarks(page))[0]);
  await undo(page);
  const afterUndo = await windowMarks(page);
  const redoAfterUndo = await buttonEnabled(page, 'Redo');
  await drawRect(page, 1, 300, 600, 400, 660); // B
  const b = await waitFor(async () => (await windowMarks(page)).find((m) => m.id !== a.id));
  const redoAfterB = await buttonEnabled(page, 'Redo');
  await redo(page); // must not bring A back
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(800);
  const win = await windowMarks(page);
  const server = await waitFor(async () => { const s = await serverMarks(backend); return s.length === 1 ? s : null; }, { timeout: 8000 }) || await serverMarks(backend);
  await page.screenshot({ path: `${OUT_DIR}/69-final.png` });
  const ok = afterUndo.length === 0 && redoAfterUndo === true && redoAfterB === false
    && win.length === 1 && win[0].id === b.id && server.length === 1 && server[0].id === b.id && errors.length === 0;
  report('69', ok ? 'PASS' : 'FAIL', `after undo marks=${afterUndo.length}, Redo lit=${redoAfterUndo}; after drawing B Redo lit=${redoAfterB}; after Redo+Ctrl+Y window=${win.map((m) => m.id.slice(0, 6))} server=${server.map((m) => String(m.id).slice(0, 6))} (B=${b.id.slice(0, 6)}, A=${a.id.slice(0, 6)}) errors=${errors.length} shot=69-final.png`);
  await context.close();
  expect(ok).toBe(true);
});

test('70 [R1] callout create + type + click away is ONE undo step', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000070';
  const backend = new FakeBackend({ documentId: docId });
  const { context, page, errors } = await openWindow(browser, backend, docId, PDF);
  await tool(page, 'Text', 'Callout');
  await dragPage(page, 1, [[150, 650], [250, 690], [330, 720]], { steps: 6 });
  await page.waitForTimeout(1000);
  await page.keyboard.type('Hello callout');
  await page.waitForTimeout(500);
  await clickPage(page, 1, 560, 760); // click away
  const created = await waitFor(async () => (await serverMarks(backend)).find((m) => m.dataType === 'callout'), { timeout: 10_000 });
  const text = JSON.stringify(created?.raw || {}).includes('Hello callout');
  await page.screenshot({ path: `${OUT_DIR}/70-created.png` });
  await undo(page); // ONE press
  const gone = await waitFor(async () => !(await serverMarks(backend)).some((m) => m.dataType === 'callout'), { timeout: 8000 });
  const visible = await page.locator('[data-anno-type="callout"], .callout-group, [data-callout-id]').count();
  const redoLit = await buttonEnabled(page, 'Redo');
  await page.screenshot({ path: `${OUT_DIR}/70-after-one-undo.png` });
  const ok = Boolean(created) && text && gone && visible === 0 && redoLit === true && errors.length === 0;
  report('70', ok ? 'PASS' : 'FAIL', `callout saved with text=${text}; after ONE Ctrl+Z: gone on server=${gone}, callout elements on page=${visible}, Redo lit=${redoLit}; errors=${errors.length} shots=70-created.png/70-after-one-undo.png`);
  await context.close();
  expect(ok).toBe(true);
});

test('71 [R2] undo keeps a colleague\'s later move (two windows)', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000071';
  const backend = new FakeBackend({ documentId: docId });
  const A = await openWindow(browser, backend, docId, PDF, { device: { viewport: { width: 1200, height: 900 } } });
  const B = await openWindow(browser, backend, docId, PDF, { device: { viewport: { width: 1200, height: 900 } } });
  await drawRect(A.page, 1, 100, 600, 220, 680);
  const rect = await waitFor(async () => (await windowMarks(B.page))[0], { timeout: 15_000 });
  expect(rect, 'B sees A\'s rectangle').toBeTruthy();
  const red = rect.stroke;
  // A: recolour the rectangle's border blue.
  await pickAt(A.page, 1, 100, 640);
  await setStrokeColor(A.page, '#0000FF');
  const blueInB = await waitFor(async () => (await windowMarks(B.page))[0]?.stroke !== red, { timeout: 10_000 });
  const blue = (await windowMarks(A.page))[0].stroke;
  // B: move the same rectangle 60 pt right.
  // (click to pick it, then drag it by its top edge between the handles —
  // the side midpoints are resize handles — as a person does)
  await pickAt(B.page, 1, 130, 600);
  await dragPage(B.page, 1, [[130, 600], [160, 600], [190, 600]], { steps: 6 });
  const moved = await waitFor(async () => {
    const m = (await windowMarks(A.page))[0];
    return m && !near(m.left, rect.left, 5) ? m : null;
  }, { timeout: 10_000 });
  const movedLeft = (await windowMarks(B.page))[0].left;
  // A: undo (its own last action = the recolour).
  await A.page.mouse.click(5, 450);
  await undo(A.page);
  const settled = await waitFor(async () => {
    const [ma, mb, ms] = [(await windowMarks(A.page))[0], (await windowMarks(B.page))[0], (await serverMarks(backend))[0]];
    return ma && mb && ms && ma.stroke === red && mb.stroke === red && ms.stroke === red ? { ma, mb, ms } : null;
  }, { timeout: 10_000 });
  const fin = settled || { ma: (await windowMarks(A.page))[0], mb: (await windowMarks(B.page))[0], ms: (await serverMarks(backend))[0] };
  await A.page.screenshot({ path: `${OUT_DIR}/71-A-after-undo.png` });
  await B.page.screenshot({ path: `${OUT_DIR}/71-B-after-undo.png` });
  // A move, not a resize: same width; and the undo keeps B's new spot.
  const posKept = [fin.ma, fin.mb, fin.ms].every((m) => m && near(m.left, movedLeft) && near(m.width, rect.width));
  const ok = Boolean(blueInB) && Boolean(moved) && Boolean(settled) && posKept && A.errors.length + B.errors.length === 0;
  report('71', ok ? 'PASS' : 'FAIL', `start left=${rect.left} ${red}; A recolour -> B saw ${blue}=${Boolean(blueInB)}; B move -> A saw left=${moved?.left}; A Ctrl+Z -> A ${fin.ma?.stroke}@${fin.ma?.left}, B ${fin.mb?.stroke}@${fin.mb?.left}, server ${fin.ms?.stroke}@${fin.ms?.left} (want ${red}@${movedLeft}, width ${rect.width} kept=${posKept}); errors=${A.errors.length + B.errors.length}; fake-backend calls: ${backend.summary().slice(0, 4).join(', ')} shots=71-A/B-after-undo.png`);
  await A.context.close();
  await B.context.close();
  expect(ok).toBe(true);
});

test('72 [R3] PDF with its own markup: undo removes only my stroke', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000072';
  const backend = new FakeBackend({ documentId: docId });
  const { context, page, errors } = await openWindow(browser, backend, docId, 'clickable-link-test.pdf');
  // The PDF's own ink + squares become marks on open (embedded import).
  const imported = await waitFor(async () => {
    const all = await serverMarks(backend);
    const imp = all.filter((m) => m.imported);
    return imp.length >= 3 ? imp : null;
  }, { timeout: 30_000 }) || [];
  await page.waitForTimeout(1500);
  const importedBefore = JSON.stringify(imported.map((m) => m.raw).sort((x, y) => String(x.id).localeCompare(String(y.id))));
  const undoLitBefore = await buttonEnabled(page, 'Undo');
  const winImportedBefore = (await windowMarks(page)).filter((m) => m.imported).length;
  await drawPen(page, 1, Array.from({ length: 30 }, (_, i) => [120 + i * 6, 500 + 10 * Math.sin(i / 3)]));
  const mine = await waitFor(async () => (await serverMarks(backend)).find((m) => !m.imported && m.type === 'path'), { timeout: 10_000 });
  await page.screenshot({ path: `${OUT_DIR}/72-drawn.png` });
  await undo(page);
  await waitFor(async () => !(await serverMarks(backend)).some((m) => m.id === mine?.id), { timeout: 8000 });
  await undo(page); // a second press must not touch the PDF's markup
  await page.waitForTimeout(1500);
  const after = await serverMarks(backend);
  const importedAfter = JSON.stringify(after.filter((m) => m.imported).map((m) => m.raw).sort((x, y) => String(x.id).localeCompare(String(y.id))));
  const winImportedAfter = (await windowMarks(page)).filter((m) => m.imported).length;
  await page.screenshot({ path: `${OUT_DIR}/72-after-undo.png` });
  const ok = imported.length >= 3 && undoLitBefore === false && Boolean(mine)
    && !after.some((m) => m.id === mine.id) && importedAfter === importedBefore
    && winImportedAfter === winImportedBefore && errors.length === 0;
  report('72', ok ? 'PASS' : 'FAIL', `PDF markup imported=${imported.length} (window ${winImportedBefore}); Undo lit before drawing=${undoLitBefore}; my stroke gone after Ctrl+Z=${!after.some((m) => m.id === mine?.id)}; PDF markup unchanged after 2x Ctrl+Z=${importedAfter === importedBefore} (window ${winImportedAfter}); errors=${errors.length} shots=72-drawn.png/72-after-undo.png`);
  await context.close();
  expect(ok).toBe(true);
});
