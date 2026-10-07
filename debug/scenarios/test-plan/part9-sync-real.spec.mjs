// TEST-PLAN Part 9 — Two windows (sync), items 59–64, on the REAL backend
// with TWO REAL ACCOUNTS (docs/handoff-2026-09-29/TEST-PLAN.md).
//
// part9-sync-local.spec.mjs runs 59–63 against an in-memory stand-in; this
// file runs them for real: account A uploads a throwaway copy of
// debug/fixtures/clickable-link-test.pdf through Home, shares it with account
// B, both open it, and every live edit travels through Supabase (REST +
// Realtime broadcast/postgres_changes + presence). Item 64 (a second account
// moves A's mark) and the presence faces are covered too, plus one phone
// (390x844, touch) window. The document is deleted through the app at the end.
//
// Skipped unless run under a verified two-account test lease (owner's test
// accounts only; see tp-real-backend.mjs). Not for CI. Run against a dev
// server whose .env points at the project (sign-in uses the dev module graph):
//   node scripts/test-account-lease.mjs run --task <ID> … -- \
//     env [TP_REALTIME_RELAY=1] PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5611 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/part9-sync-real.spec.mjs
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DESKTOP, OUT_DIR, PHONE, pageFrame, report } from './tp-local-doc.mjs';
import { drawRect, pickMark, selectTool, setStrokeColor, tool, waitFor, windowMarks } from './tp-actions.mjs';
import {
  deleteThroughApp, docIdByName, goHome, grantEditor, myRole, openFromHome, presence, realAccounts,
  realLaunchOptions, shareThroughApp, signedInWindow, uploadDocument, withClient,
} from './tp-real-backend.mjs';

const ACCOUNTS = realAccounts();
const VARIANT = 'two-accounts-real-backend';
const FIXTURE = fileURLToPath(new URL('../../fixtures/clickable-link-test.pdf', import.meta.url));

test.use({ video: 'off', actionTimeout: 15_000, navigationTimeout: 90_000, launchOptions: realLaunchOptions() });
test.describe.configure({ mode: 'serial', timeout: 300_000 });

// One run = one document. Shared by the items below, in order.
const S = { openedAt: 0, name: null, docId: null, A: null, B: null, P: null, browser: null, ids: {}, share: null };

/** This window's own marks on page 1 (not the PDF's imported ones). */
const ownMarks = async (page) => (await windowMarks(page)).filter((m) => !m.imported);
const markIn = async (page, id) => (await ownMarks(page)).find((m) => m.id === id) || null;
// type: 'path' for ink; 'shape' for anything else (rectangles).
const ofType = (m, type) => !type || (type === 'shape' ? m.type !== 'path' : m.type === type);
const newMark = (page, known, type) => waitFor(async () => (await ownMarks(page)).find((m) => !known.has(m.id) && ofType(m, type)), { timeout: 15_000, every: 50 });
const openDialogs = (page) => page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
  .filter((e) => e.getBoundingClientRect().width > 0).map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 60)));
const errs = () => [S.A, S.B, S.P].filter(Boolean).reduce((n, w) => n + w.errors.length, 0);

test.describe('Part 9 on the real backend, two accounts', () => {
  test.skip(!ACCOUNTS, 'run through scripts/test-account-lease.mjs run with a two-account lease');

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(420_000);
    S.browser = browser;
    S.name = `tp-sync-real-${Date.now()}.pdf`;
    S.A = await signedInWindow(browser, ACCOUNTS.A, DESKTOP);
    // Unique bytes per run: Home recognises an identical file and offers the
    // existing document instead of a new one.
    const pdf = Buffer.concat([readFileSync(FIXTURE), Buffer.from(`\n%test-plan run ${S.name}\n`)]);
    await uploadDocument(S.A.page, S.name, pdf);
    S.docId = await docIdByName(S.A.page, S.name);
    await goHome(S.A.page);
    // Share through the app first; the Free plan refuses invites, and then the
    // owner's own session makes the same collaborator row the invite would.
    S.share = await shareThroughApp(S.A.page, S.name, ACCOUNTS.B.email);
    S.share.fallback = S.share.sent ? null : await grantEditor(S.A.page, S.docId, ACCOUNTS.B.email);
    S.B = await signedInWindow(browser, ACCOUNTS.B, DESKTOP);
    S.share.roleB = await myRole(S.B.page, S.docId);
    await openFromHome(S.A.page, S.name);
    await openFromHome(S.B.page, S.name);
    S.openedAt = Date.now();
  });

  test.afterAll(async () => {
    test.setTimeout(240_000);
    // Delete the throwaway document through the app (A owns it).
    if (S.A && S.name) {
      try {
        if (S.P) await S.P.context.close();
        if (S.B) await S.B.context.close();
        await goHome(S.A.page);
        await deleteThroughApp(S.A.page, S.name);
        const left = await docIdByName(S.A.page, S.name);
        report('cleanup', left ? 'FAIL' : 'PASS', `throwaway document ${S.name} deleted through Home -> Archive -> Delete forever; still there=${Boolean(left)}`, VARIANT);
      } finally {
        await S.A.context.close();
      }
    }
  });

  test('setup: A uploads, shares with B, both open it; both faces show', async () => {
    const t0 = Date.now();
    const both = await waitFor(async () => {
      const [a, b] = [await presence(S.A.page), await presence(S.B.page)];
      return a.faces.length === 2 && b.faces.length === 2 ? { a, b } : null;
    }, { timeout: 30_000, every: 500 });
    const facesMs = Date.now() - t0;
    const a = both?.a || await presence(S.A.page);
    const b = both?.b || await presence(S.B.page);
    await S.A.page.screenshot({ path: `${OUT_DIR}/real-setup-A.png` });
    await S.B.page.screenshot({ path: `${OUT_DIR}/real-setup-B.png` });
    const shareNote = S.share.sent ? 'Share dialog sent the invite'
      : `Share dialog refused ("${S.share.blocked || S.share.text.slice(0, 80)}"), owner session added B as editor: ${S.share.fallback}`;
    const ok = Boolean(S.docId) && S.share.roleB === 'editor' && Boolean(both)
      && [...a.faces, ...b.faces].every((f) => f.dot === 'here') && errs() === 0;
    report('59-64 setup', ok ? 'PASS' : 'FAIL', `doc ${S.docId?.slice(0, 8)}; ${shareNote}; B's role from server=${S.share.roleB}; people token A "${a.label}" faces ${JSON.stringify(a.faces.map((f) => `${f.initials}:${f.dot}`))}, B "${b.label}" faces ${JSON.stringify(b.faces.map((f) => `${f.initials}:${f.dot}`))} (both within ${facesMs} ms of opening); shots=real-setup-A.png/real-setup-B.png`, VARIANT);
    expect(ok).toBe(true);
  });

  test('59 [Y2] live drawing: ghost ink in B while A draws, real stroke right after', async () => {
    const { A, B } = S;
    const known = new Set((await ownMarks(B.page)).map((m) => m.id));
    await tool(A.page, 'Draw', 'Pen');
    const frame = await pageFrame(A.page, 1);
    const pts = Array.from({ length: 40 }, (_, i) => frame.toScreen(80 + i * 8, 745 + 10 * Math.sin(i / 5)));
    const t0 = Date.now();
    let firstGhostMs = null;
    let maxGhostPoints = 0;
    let drawing = true;
    const watch = (async () => {
      while (drawing) {
        const g = await B.page.evaluate(() => [...document.querySelectorAll('[data-live-stroke-ghost="true"]')].map((e) => Number(e.getAttribute('data-live-stroke-points')) || 0));
        if (g.length && firstGhostMs == null) firstGhostMs = Date.now() - t0;
        maxGhostPoints = Math.max(maxGhostPoints, ...g, 0);
        await new Promise((r) => setTimeout(r, 40));
      }
    })();
    await A.page.mouse.move(pts[0][0], pts[0][1]);
    await A.page.mouse.down();
    for (const [x, y] of pts.slice(1)) { await A.page.mouse.move(x, y, { steps: 2 }); await A.page.waitForTimeout(45); }
    await B.page.screenshot({ path: `${OUT_DIR}/real-59-B-while-A-draws.png` });
    const drawMs = Date.now() - t0;
    await A.page.mouse.up();
    const tUp = Date.now();
    drawing = false;
    await watch;
    const landed = await newMark(B.page, known, 'path');
    const landMs = Date.now() - tUp;
    const ghostsLeft = await waitFor(async () => (await B.page.locator('[data-live-stroke-ghost="true"]').count()) === 0, { timeout: 5000 });
    await B.page.screenshot({ path: `${OUT_DIR}/real-59-B-landed.png` });
    S.ids.pen = landed?.id;
    await A.page.keyboard.press('Escape');
    const ok = firstGhostMs != null && firstGhostMs < drawMs && maxGhostPoints > 5 && Boolean(landed) && landMs < 3000 && ghostsLeft && errs() === 0;
    report(59, ok ? 'PASS' : 'FAIL', `A drew for ${drawMs} ms; B showed ghost ink after ${firstGhostMs} ms (up to ${maxGhostPoints} points while A was still drawing); real stroke in B ${landMs} ms after A let go; ghost cleared=${ghostsLeft}; shots=real-59-B-while-A-draws.png/real-59-B-landed.png`, VARIANT);
    expect(ok).toBe(true);
  });

  test('60 [Y2] live moves: B sees A\'s drag within a moment', async () => {
    const { A, B } = S;
    const known = new Set((await ownMarks(B.page)).map((m) => m.id));
    const tDraw = Date.now();
    await drawRect(A.page, 1, 440, 610, 520, 670);
    const r0 = await newMark(B.page, known, 'shape');
    const appearMs = Date.now() - tDraw;
    S.ids.r60 = r0?.id;
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
    await A.page.mouse.up();
    const tUp = Date.now();
    const target = (await waitFor(async () => { const m = await markIn(A.page, r0.id); return m && m.left > r0.left + 5 ? m : null; }, { timeout: 5000 })) || {};
    const seen = await waitFor(async () => { const m = await markIn(B.page, r0.id); return m && Math.abs(m.left - target.left) < 0.75 ? m : null; }, { timeout: 10_000, every: 50 });
    const lagMs = Date.now() - tUp;
    await B.page.screenshot({ path: `${OUT_DIR}/real-60-B-after-move.png` });
    const movedDuringDrag = midDragLeft != null && midDragLeft > grab.x + 5;
    const ok = Boolean(seen) && lagMs < 2000 && errs() === 0;
    report(60, ok ? 'PASS' : 'FAIL', `new rectangle reached B ${appearMs} ms after A started drawing it; A moved it ${r0.left} -> ${target.left}; B had it there ${lagMs} ms after A let go; B already showed it moving mid-drag=${movedDuringDrag}; shot=real-60-B-after-move.png`, VARIANT);
    expect(ok).toBe(true);
  });

  test('61 [Y1] two edits to one mark at once: colour from A and spot from B both stay', async () => {
    const { A, B } = S;
    const known = new Set((await ownMarks(B.page)).map((m) => m.id));
    await drawRect(A.page, 1, 60, 610, 140, 670);
    const r0 = await newMark(B.page, known, 'shape');
    S.ids.r61 = r0?.id;
    await pickMark(A.page, r0.id);
    const grab = await pickMark(B.page, r0.id);
    const sx = grab.x + grab.w * 0.3;
    const t0 = Date.now();
    await Promise.all([
      setStrokeColor(A.page, '#0000FF'),
      (async () => {
        await B.page.mouse.move(sx, grab.y);
        await B.page.mouse.down();
        for (let k = 1; k <= 8; k += 1) await B.page.mouse.move(sx + k * 8, grab.y, { steps: 2 });
        await B.page.mouse.up();
      })(),
    ]);
    const good = (m) => m && m.stroke === 'rgba(0, 0, 255, 1)' && m.left > r0.left + 5;
    const end = await waitFor(async () => {
      const [a, b] = [await markIn(A.page, r0.id), await markIn(B.page, r0.id)];
      return good(a) && good(b) && Math.abs(a.left - b.left) < 0.75 ? { a, b } : null;
    }, { timeout: 12_000, every: 100 });
    const convergeMs = Date.now() - t0;
    const fin = end || { a: await markIn(A.page, r0.id), b: await markIn(B.page, r0.id) };
    await A.page.screenshot({ path: `${OUT_DIR}/real-61-A-end.png` });
    await B.page.screenshot({ path: `${OUT_DIR}/real-61-B-end.png` });
    const ok = Boolean(end) && errs() === 0;
    report(61, ok ? 'PASS' : 'FAIL', `start ${r0.stroke}@${r0.left}; end A ${fin.a?.stroke}@${fin.a?.left}, B ${fin.b?.stroke}@${fin.b?.left} (want blue + moved in both; server checked after reload in 64); both agreed ${convergeMs} ms after the two edits started; shots=real-61-A-end.png/real-61-B-end.png`, VARIANT);
    expect(ok).toBe(true);
  });

  test('62 [Y3] Survey Markers live', async () => {
    // Survey Markers need a survey template; the Survey panel says what this
    // account can do. Not faked: if the account cannot place markers, say so.
    const { A } = S;
    const open = A.page.getByRole('button', { name: /^(Survey|Expand Survey panel|Open survey)$/ }).filter({ visible: true }).first();
    await open.click().catch(() => {});
    await A.page.waitForTimeout(1500);
    const text = (await A.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    const proOnly = /Survey templates are a Pro feature[^.]*\./.exec(text)?.[0];
    const noTemplates = /No templates available/.test(text);
    await A.page.screenshot({ path: `${OUT_DIR}/real-62-A-survey.png` });
    await A.page.getByRole('button', { name: 'Exit Survey' }).first().click().catch(() => {});
    await A.page.keyboard.press('Escape');
    if (proOnly || noTemplates) {
      report(62, 'BLOCKED', `the test accounts cannot place Survey Markers (${[proOnly, noTemplates && 'Survey panel: "No templates available"'].filter(Boolean).join('; ')}); Survey templates are Pro-only, both accounts are Free; needs a Pro test account with one template; local-backend run covers the sync code; shot=real-62-A-survey.png`, VARIANT);
      test.skip(true, 'Survey Markers need a Pro account with a template');
    }
    report(62, 'NOT-RUN', 'Survey panel opened with templates; marker walk not written for the real backend yet', VARIANT);
  });

  test('63 [M15] Delete stays on your mark while the other window deletes another', async () => {
    const { A, B } = S;
    const known = new Set((await ownMarks(B.page)).map((m) => m.id));
    await drawRect(A.page, 1, 160, 680, 230, 715); // 1
    await drawRect(A.page, 1, 260, 680, 330, 715); // 2
    await drawRect(A.page, 1, 360, 680, 430, 715); // 3 (must survive)
    const ids = await waitFor(async () => {
      const m = (await ownMarks(B.page)).filter((x) => !known.has(x.id) && ofType(x, 'shape'));
      return m.length === 3 ? m.sort((x, y) => x.left - y.left).map((x) => x.id) : null;
    }, { timeout: 20_000 });
    const [r1, r2, r3] = ids;
    S.ids.r63 = ids;
    await pickMark(A.page, r2);
    await pickMark(B.page, r1);
    const t0 = Date.now();
    await B.page.keyboard.press('Delete');
    const goneInA = await waitFor(async () => !(await markIn(A.page, r1)), { timeout: 10_000, every: 50 });
    const deleteSeenMs = Date.now() - t0;
    await A.page.keyboard.press('Delete');
    const t1 = Date.now();
    const these = (list) => list.filter((m) => ids.includes(m.id)).map((m) => ids.indexOf(m.id) + 1);
    const end = await waitFor(async () => {
      const [a, b] = [these(await ownMarks(A.page)), these(await ownMarks(B.page))];
      return a.join() === '3' && b.join() === '3' ? true : null;
    }, { timeout: 10_000, every: 50 });
    const secondMs = Date.now() - t1;
    const [a, b] = [these(await ownMarks(A.page)), these(await ownMarks(B.page))];
    await A.page.screenshot({ path: `${OUT_DIR}/real-63-A-end.png` });
    const ok = Boolean(goneInA) && Boolean(end) && errs() === 0;
    report(63, ok ? 'PASS' : 'FAIL', `B deleted rect 1 -> gone in A after ${deleteSeenMs} ms; A's Delete with rect 2 picked -> left in A [${a}], B [${b}] (want only 3), B caught up in ${secondMs} ms; shot=real-63-A-end.png`, VARIANT);
    expect(ok).toBe(true);
  });

  test('64 [M9] open editing: B (second account, editor) moves A\'s mark, no pop-up', async () => {
    const { A, B } = S;
    const id = S.ids.r60;
    const nativeDialogs = [];
    B.page.on('dialog', (d) => { nativeDialogs.push(d.message()); d.dismiss().catch(() => {}); });
    const before = await markIn(B.page, id);
    const grab = await pickMark(B.page, id);
    const dialogsAfterPick = await openDialogs(B.page);
    const sx = grab.x + grab.w * 0.3;
    await B.page.mouse.move(sx, grab.y);
    await B.page.mouse.down();
    for (let k = 1; k <= 8; k += 1) { await B.page.mouse.move(sx, grab.y + k * 5, { steps: 2 }); await B.page.waitForTimeout(30); }
    await B.page.mouse.up();
    const tUp = Date.now();
    await B.page.waitForTimeout(300);
    const dialogsAfterMove = await openDialogs(B.page);
    const moved = await waitFor(async () => { const m = await markIn(B.page, id); return m && m.top > before.top + 10 ? m : null; }, { timeout: 5000 });
    const seenInA = await waitFor(async () => { const m = await markIn(A.page, id); return m && moved && Math.abs(m.top - moved.top) < 0.75 ? m : null; }, { timeout: 10_000, every: 50 });
    const lagMs = Date.now() - tUp;
    await B.page.screenshot({ path: `${OUT_DIR}/real-64-B-after-move.png` });
    // What the server kept: a fresh load in B.
    await B.page.waitForTimeout(2500);
    // (A reload lands on Home; open the document again from there.)
    await B.page.reload({ waitUntil: 'load' });
    await openFromHome(B.page, S.name);
    const reloaded = await waitFor(async () => { const m = await ownMarks(B.page); return m.length ? m : null; }, { timeout: 30_000, every: 500 }) || [];
    const byId = Object.fromEntries(reloaded.map((m) => [m.id, m]));
    const kept = {
      pen: Boolean(byId[S.ids.pen]),
      r60: byId[id] && moved ? Math.abs(byId[id].top - moved.top) < 0.75 : false,
      r61: byId[S.ids.r61] ? byId[S.ids.r61].stroke === 'rgba(0, 0, 255, 1)' : false,
      r63: (S.ids.r63 || []).map((x) => Boolean(byId[x])).join('/'),
      // 61's colour change, made while B was dragging the same mark, has its
      // History line on the server (it was refused once: a live-edit token
      // with U+0000 in the row's preview).
      r61History: await withClient(A.page, async (sb, { doc, mark }) => {
        const { data } = await sb.from('document_history_events').select('summary').eq('document_id', doc).eq('annotation_id', mark);
        return (data || []).some((r) => /colou?r/i.test(r.summary || ''));
      }, { doc: S.docId, mark: S.ids.r61 }),
    };
    const ok = Boolean(moved) && Boolean(seenInA) && nativeDialogs.length === 0 && dialogsAfterPick.length === 0 && dialogsAfterMove.length === 0
      && kept.pen && kept.r60 && kept.r61 && kept.r61History && kept.r63 === 'false/false/true' && errs() === 0;
    report(64, ok ? 'PASS' : 'FAIL', `B (editor, other account) moved A's rectangle ${before?.top} -> ${moved?.top}; pop-ups in B: native ${nativeDialogs.length}, after pick ${JSON.stringify(dialogsAfterPick)}, after move ${JSON.stringify(dialogsAfterMove)}; A saw it ${lagMs} ms after B let go; after reloading B the server kept: pen=${kept.pen}, B's move=${kept.r60}, 61 blue=${kept.r61}, 61 colour History line=${kept.r61History}, 63 rects 1/2/3=${kept.r63}; shot=real-64-B-after-move.png`, VARIANT);
    expect(ok).toBe(true);
  });

  test('phone: B on a 390x844 touch phone drags A\'s mark; A sees it; phone sees A\'s ink', async () => {
    const { A } = S;
    S.P = await signedInWindow(S.browser, ACCOUNTS.B, PHONE);
    const P = S.P;
    const row = P.page.getByText(S.name.slice(0, 20)).filter({ visible: true }).first();
    await row.waitFor({ timeout: 60_000 });
    await row.tap();
    await P.page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().waitFor({ timeout: 90_000 });
    await P.page.waitForTimeout(4000);
    const label = await P.page.evaluate(() => [...document.querySelectorAll('[aria-label$="active users"], [aria-label$="active user"]')].map((e) => e.getAttribute('aria-label'))[0] || null);
    const id = S.ids.r61;
    // Touch drag with the select tool (trusted CDP touch events).
    await P.page.getByRole('button', { name: 'Rectangle Select', exact: true }).filter({ visible: true }).first().tap();
    await P.page.waitForTimeout(400);
    const box = await P.page.evaluate((key) => {
      const r = document.querySelector(`[data-anno-id="${CSS.escape(key)}"]`)?.getBoundingClientRect();
      return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    }, id);
    const before = await markIn(P.page, id);
    const cdp = await P.context.newCDPSession(P.page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 5, radiusY: 5, force: 0.7 }] });
    // On its border (the rectangle has no fill), as on the desktop.
    const x0 = box.x + box.w * 0.3;
    const y0 = box.y + 1;
    await touch('touchStart', x0, y0); await P.page.waitForTimeout(80);
    await touch('touchEnd', x0, y0); await P.page.waitForTimeout(500); // tap to pick
    await touch('touchStart', x0, y0); await P.page.waitForTimeout(60);
    for (let k = 1; k <= 12; k += 1) { await touch('touchMove', x0 + k * 3, y0 + k * 2); await P.page.waitForTimeout(16); }
    await touch('touchEnd', x0 + 36, y0 + 24);
    const tUp = Date.now();
    const moved = await waitFor(async () => { const m = await markIn(P.page, id); return m && (Math.abs(m.left - before.left) > 5 || Math.abs(m.top - before.top) > 5) ? m : null; }, { timeout: 5000 });
    const seenInA = await waitFor(async () => { const m = await markIn(A.page, id); return m && moved && Math.abs(m.left - moved.left) < 0.75 && Math.abs(m.top - moved.top) < 0.75 ? m : null; }, { timeout: 10_000, every: 50 });
    const lagMs = Date.now() - tUp;
    await P.page.screenshot({ path: `${OUT_DIR}/real-phone-after-drag.png` });
    // And the other way: A draws, the phone shows ghost ink then the stroke.
    const known = new Set((await ownMarks(P.page)).map((m) => m.id));
    await tool(A.page, 'Draw', 'Pen');
    const frame = await pageFrame(A.page, 1);
    const pts = Array.from({ length: 24 }, (_, i) => frame.toScreen(120 + i * 10, 775 + 6 * Math.sin(i / 3)));
    let ghostSeen = false;
    await A.page.mouse.move(pts[0][0], pts[0][1]);
    await A.page.mouse.down();
    for (const [x, y] of pts.slice(1)) {
      await A.page.mouse.move(x, y, { steps: 2 });
      if (!ghostSeen) ghostSeen = (await P.page.locator('[data-live-stroke-ghost="true"]').count()) > 0;
    }
    await A.page.mouse.up();
    const tUp2 = Date.now();
    const landed = await newMark(P.page, known, 'path');
    const landMs = Date.now() - tUp2;
    await P.page.screenshot({ path: `${OUT_DIR}/real-phone-ink-landed.png` });
    await A.page.keyboard.press('Escape');
    const ok = Boolean(moved) && Boolean(seenInA) && Boolean(landed) && errs() === 0;
    report('phone', ok ? 'PASS' : 'FAIL', `phone (B, 390x844 touch) people token "${label}"; phone dragged rect 61 by touch ${before?.left},${before?.top} -> ${moved?.left},${moved?.top}; A saw it ${lagMs} ms after the finger lifted; A's pen stroke: ghost on phone while drawing=${ghostSeen}, stroke landed on phone ${landMs} ms after A let go; shots=real-phone-after-drag.png/real-phone-ink-landed.png`, VARIANT);
    expect(ok).toBe(true);
  });

  test('presence while B keeps working for 2.5 minutes: B stays on A\'s people token, green dot', async () => {
    // The plan's "both faces show, here/idle dots": B stays in the document on
    // one page and keeps editing (a small nudge of one mark every 20 s) while
    // A watches B's face. A person who is working here should stay "here".
    test.setTimeout(300_000);
    const { A, B } = S;
    if (S.P) { await S.P.context.close(); S.P = null; }
    const id = S.ids.r60;
    const t0 = Date.now();
    const samples = [];
    let nextEdit = 0;
    while (Date.now() - t0 < 150_000) {
      const sec = Math.round((Date.now() - t0) / 1000);
      if (sec >= nextEdit) {
        await pickMark(B.page, id);
        await B.page.keyboard.press('ArrowRight');
        await B.page.keyboard.press('Escape');
        nextEdit += 20;
      }
      const a = await presence(A.page);
      const bFace = a.faces.find((f) => f.initials !== a.faces[0]?.initials) || null;
      samples.push(`${sec}s:${a.faces.length}${bFace ? `/${bFace.dot}` : ''}`);
      await A.page.waitForTimeout(10_000);
    }
    await A.page.locator('[data-presence-group]').first().hover().catch(() => {});
    await A.page.waitForTimeout(400);
    const rows = await A.page.evaluate(() => [...document.querySelectorAll('[data-presence-row]')].map((r) => `${r.innerText.replace(/\s+/g, ' ').trim()} [${r.getAttribute('data-presence-row')}]`));
    await A.page.screenshot({ path: `${OUT_DIR}/real-presence-later-A.png` });
    const ok = samples.every((x) => /:2\/here$/.test(x));
    report('presence-later', ok ? 'PASS' : 'FAIL', `B edited every 20 s on page 1; A's view of B over time (faces/B's dot): ${samples.join(' ')}; list at the end ${JSON.stringify(rows)}; shot=real-presence-later-A.png`, VARIANT);
    expect(ok).toBe(true);
  });
});
