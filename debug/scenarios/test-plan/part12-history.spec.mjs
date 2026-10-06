// TEST-PLAN Part 12 — History (items 73–80), checked by the machine.
//
// Real document path against the in-memory fake backend (History rows go to
// its document_history_events table and are read back from it). No network,
// no database. Phone item 79 runs in Chromium 390x844 touch AND WebKit (the
// iOS Safari engine).
// Run (not in CI; the config starts Vite; .env needs VITE_SUPABASE_URL/KEY):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5483 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/part12-history.spec.mjs
import { test, expect, webkit } from '@playwright/test';
import { OUT_DIR, PHONE, PHONE_WEBKIT, report } from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import {
  dragPage, drawRect, openWindow, pickAt, pickMark, serverMarks, setStrokeColor, undo, waitFor, windowMarks,
} from './tp-actions.mjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 360_000 });

const PDF = 'Package 2 - Rev 4 -- IC.pdf';
const COLORS = {
  created: 'rgb(74, 144, 226)', edited: 'rgb(84, 140, 113)', deleted: 'rgb(217, 90, 86)', restored: 'rgb(111, 211, 216)',
};
const UUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}-|pdf-appearance|\b[0-9a-f]{24,}\b/i;

const feed = (page) => page.evaluate(() => ({
  days: [...document.querySelectorAll('.dh-day')].map((e) => e.textContent),
  rows: [...document.querySelectorAll('.dh-row:not(.child)')].map((e) => ({
    key: e.dataset.key, id: e.dataset.testid || e.getAttribute('data-testid'), text: e.querySelector('.dh-s')?.textContent || '',
    meta: e.querySelector('.dh-m')?.textContent || '', status: e.dataset.status, kind: e.dataset.kind, mark: e.dataset.mark,
    dot: e.querySelector('.dh-st') ? getComputedStyle(e.querySelector('.dh-st')).backgroundColor : null,
  })),
  chips: [...document.querySelectorAll('.dh-chip')].map((e) => `${e.textContent}${e.getAttribute('aria-pressed') === 'true' ? '*' : ''}`),
  legend: [...document.querySelectorAll('.dh-legend span')].map((e) => ({ status: e.dataset.status, label: e.textContent, color: getComputedStyle(e.querySelector('i')).backgroundColor })),
  legendBelowChips: (() => {
    const c = document.querySelector('.dh-chips')?.getBoundingClientRect();
    const l = document.querySelector('.dh-legend')?.getBoundingClientRect();
    return Boolean(c && l && l.top >= c.bottom - 1);
  })(),
  markChip: document.querySelector('[data-testid="document-history-mark-filter"]')?.textContent || null,
  count: document.querySelector('[data-testid="document-history-count"]')?.textContent || null,
}));

async function openHistory(page) {
  await page.getByRole('button', { name: 'History', exact: true }).first().click();
  await page.locator('[data-testid="kal48-revisions-panel"]').first().waitFor({ timeout: 15_000 });
  await waitFor(async () => (await feed(page)).rows.length > 0, { timeout: 15_000 });
  await page.waitForTimeout(600);
}

const rowByText = (page, re) => page.locator('.dh-row:not(.child)').filter({ hasText: re }).first();

/** The on-page highlight: its outline box, its wash, and the mark's own box. */
const highlightInfo = (page, markId) => page.evaluate((id) => {
  const root = document.getElementById('document-history-overlay');
  const layer = root?.querySelector('[data-history-layer="highlight"]');
  const lines = layer ? [...layer.querySelectorAll('.dh-line')] : [];
  const line = lines[0];
  const r = line?.getBoundingClientRect();
  const g = id ? document.querySelector(`[data-anno-id="${CSS.escape(id)}"]`) : null;
  // The mark as drawn: its shapes' boxes grown by half their stroke.
  let mark = null;
  if (g) {
    for (const s of g.querySelectorAll('rect, path, ellipse, line, polyline, polygon, circle')) {
      const b = s.getBoundingClientRect();
      const sw = parseFloat(getComputedStyle(s).strokeWidth) || 0;
      const ctm = s.getScreenCTM();
      const half = (sw * (ctm ? Math.hypot(ctm.a, ctm.b) : 1)) / 2;
      const bb = { l: b.left - half, t: b.top - half, r: b.right + half, b: b.bottom + half };
      mark = mark ? { l: Math.min(mark.l, bb.l), t: Math.min(mark.t, bb.t), r: Math.max(mark.r, bb.r), b: Math.max(mark.b, bb.b) } : bb;
    }
  }
  const anims = root ? root.getAnimations({ subtree: true }).map((a) => ({ iterations: a.effect?.getTiming?.().iterations, state: a.playState })) : [];
  return {
    shown: Boolean(layer?.classList.contains('in')),
    lines: lines.length,
    washes: layer ? layer.querySelectorAll('.dh-wash').length : 0,
    stroke: line ? getComputedStyle(line).stroke : null,
    outline: r ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null,
    mark,
    infiniteAnims: anims.filter((a) => a.iterations === Infinity).length,
    ghosts: root ? root.querySelectorAll('.dh-ghost').length : 0,
    ghostDash: root?.querySelector('.dh-ghost') ? getComputedStyle(root.querySelector('.dh-ghost')).strokeDasharray : null,
    pins: root ? root.querySelectorAll('.dh-restore-pin').length : 0,
    pinBg: root?.querySelector('.dh-restore-pin') ? getComputedStyle(root.querySelector('.dh-restore-pin')).backgroundColor : null,
    pinText: root?.querySelector('.dh-restore-pin')?.textContent || null,
  };
}, markId);

const surrounds = (h) => Boolean(h.outline && h.mark
  && h.outline.l <= h.mark.l + 0.5 && h.outline.t <= h.mark.t + 0.5 && h.outline.r >= h.mark.r - 0.5 && h.outline.b >= h.mark.b - 0.5);
const pads = (h) => (h.outline && h.mark ? [h.mark.l - h.outline.l, h.mark.t - h.outline.t, h.outline.r - h.mark.r, h.outline.b - h.mark.b].map((v) => Math.round(v * 10) / 10) : null);

/** Another person's History rows, as the server would hold them. */
function otherPersonRows(docId, n, { startMs, stepMs, prefix = 'seed' }) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const at = new Date(startMs - i * stepMs).toISOString();
    const markId = `${prefix}-mark-${i}`;
    const kind = ['move', 'recolor', 'resize'][i % 3];
    const summary = { move: 'Sam Lee moved a rectangle on page 1', recolor: 'Sam Lee changed the color of a rectangle on page 1', resize: 'Sam Lee resized a rectangle on page 1' }[kind];
    rows.push({
      id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, '0')}`,
      document_id: docId,
      user_id: 'sam-lee-test',
      client_event_id: `${prefix}:${i}`,
      event_type: 'local_annotation_history_added',
      source: 'test-seed',
      page_number: 1,
      annotation_id: markId,
      summary,
      payload: { type: 'local_annotation_history_added', actionType: kind, annotationType: 'rect', annotationId: markId, pageNumber: 1, actorName: 'Sam Lee' },
      is_undoable: true,
      is_checkpoint: false,
      occurred_at: at,
      created_at: at,
    });
  }
  return rows;
}

// One working document shared by 73–76, 78 and 80, as a person would build it.
async function buildWorkingDoc(browser, docId) {
  const backend = new FakeBackend({ documentId: docId });
  backend.table('document_history_events').push(...otherPersonRows(docId, 3, { startMs: Date.now() - 26 * 3600_000, stepMs: 600_000, prefix: 'sam' })); // yesterday
  const w = await openWindow(browser, backend, docId, PDF);
  const { page } = w;
  await drawRect(page, 1, 100, 600, 220, 680); // rectangle 1
  await drawRect(page, 1, 300, 600, 400, 680); // rectangle 2
  const ids = await waitFor(async () => { const m = await windowMarks(page); return m.length === 2 ? m.map((x) => x.id) : null; });
  // Move rectangle 1 three times (top edge between the handles), then recolour it.
  await pickAt(page, 1, 130, 600);
  for (let k = 0; k < 3; k += 1) {
    await dragPage(page, 1, [[130 + k * 15, 600], [137 + k * 15, 600], [145 + k * 15, 600]], { steps: 4 });
    await page.waitForTimeout(500);
  }
  await setStrokeColor(page, '#0000FF');
  // Delete rectangle 2.
  await pickAt(page, 1, 330, 600);
  await page.keyboard.press('Delete');
  await waitFor(async () => (await windowMarks(page)).length === 1);
  await page.mouse.click(5, 450);
  await page.waitForTimeout(1500);
  return { ...w, backend, rect1: ids[0], rect2: ids[1] };
}

test('73–76, 78, 80 History feed, jump, ghost + Restore, pick a mark, clean-up', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000073';
  const { context, page, errors, backend, rect1, rect2 } = await buildWorkingDoc(browser, docId);
  await openHistory(page);
  await page.screenshot({ path: `${OUT_DIR}/73-feed.png` });

  // ---- 73 feed
  const f = await feed(page);
  const rawIds = f.rows.filter((r) => UUIDISH.test(r.text) || UUIDISH.test(r.meta));
  const folded = f.rows.find((r) => /3 edits/.test(r.text));
  const searchBtn = page.getByRole('button', { name: 'Search history' }).first();
  await searchBtn.click();
  await page.locator('[data-testid="document-history-search"] input, input[data-testid="document-history-search"], .dh-search input, input.dh-search').first().fill('color');
  await page.waitForTimeout(600);
  const searched = await feed(page);
  await page.getByRole('button', { name: 'Close search' }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('[data-testid="document-history-filter-mine"], [data-testid="document-history-filter-me"]').first().click().catch(async () => {
    await page.locator('.dh-chip').filter({ hasText: 'Only me' }).first().click();
  });
  await page.waitForTimeout(500);
  const mine = await feed(page);
  await page.locator('.dh-chip').filter({ hasText: 'Deleted' }).first().click();
  await page.waitForTimeout(500);
  const deletedOnly = await feed(page);
  await page.locator('.dh-chip').filter({ hasText: 'Everyone' }).first().click();
  await page.waitForTimeout(500);
  const ok73 = f.days.length >= 2 && f.days.includes('Today') && rawIds.length === 0 && Boolean(folded)
    && ['Everyone', 'Only me', 'Deleted'].every((c) => f.chips.some((x) => x.startsWith(c)))
    && searched.rows.length >= 1 && searched.rows.every((r) => /colou?r/i.test(r.text))
    && mine.rows.length > 0 && mine.rows.every((r) => !/\bSam\b/.test(r.text)) && f.rows.some((r) => /\bSam\b/.test(r.text))
    && deletedOnly.rows.length >= 1 && deletedOnly.rows.every((r) => r.status === 'deleted');
  report('73', ok73 ? 'PASS' : 'FAIL', `days=${JSON.stringify(f.days)} rows=${f.rows.length} (${f.rows.map((r) => r.text).join(' / ')}); 3 moves folded="${folded?.text}"; raw ids shown=${rawIds.length}; chips=${f.chips}; search "color" -> ${searched.rows.length} row(s); Only me hides Sam's rows=${mine.rows.every((r) => !/\bSam\b/.test(r.text))}; Deleted -> ${deletedOnly.rows.map((r) => r.status)}; shot=73-feed.png`);

  // ---- 74 jump + glow
  await page.evaluate(() => window.__navigateToPage?.(6));
  await page.waitForTimeout(1500);
  const zoomBefore = await page.getByRole('button', { name: 'Edit zoom percentage' }).first().textContent().catch(() => null);
  await rowByText(page, /changed the color/).click();
  await page.waitForTimeout(1800);
  const h74 = await highlightInfo(page, rect1);
  const pageNow = await page.evaluate(() => {
    const pg = document.querySelector('.survey-pdfjs-page-div[data-page-number="1"]')?.getBoundingClientRect();
    return pg ? pg.top < innerHeight && pg.bottom > 0 : false;
  });
  const markOnScreen = h74.mark ? h74.mark.t >= 0 && h74.mark.b <= 900 && h74.mark.l >= 0 && h74.mark.r <= 1440 : false;
  const zoomAfter = await page.getByRole('button', { name: 'Edit zoom percentage' }).first().textContent().catch(() => null);
  await page.screenshot({ path: `${OUT_DIR}/74-jump.png` });
  const steady1 = await highlightInfo(page, rect1);
  await page.waitForTimeout(700);
  const steady2 = await highlightInfo(page, rect1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const cleared = await highlightInfo(page, rect1);
  const ok74 = pageNow && markOnScreen && h74.shown && surrounds(h74) && h74.stroke === COLORS.created && !cleared.shown;
  report('74', ok74 ? 'PASS' : 'FAIL', `from page 6: page 1 on screen=${pageNow}, mark on screen=${markOnScreen}, zoom ${zoomBefore} -> ${zoomAfter}; blue outline shown=${h74.shown} colour=${h74.stroke} surrounds mark=${surrounds(h74)} pads(px l,t,r,b)=${JSON.stringify(pads(h74))}; Esc fades it=${!cleared.shown}; shot=74-jump.png`);

  // ---- 80 (highlight part): one wash + one thin outline, fully around, no pulse
  const ok80hl = h74.washes === 1 && h74.lines === 1 && surrounds(h74) && steady1.infiniteAnims === 0
    && JSON.stringify(steady1.outline) === JSON.stringify(steady2.outline);

  // ---- 75 ghost + Restore (only on delete lines)
  await rowByText(page, /changed the color/).click();
  await page.waitForTimeout(800);
  const restoreOnNonDelete = await page.locator('[data-testid^="document-history-restore-"]').count() + (await highlightInfo(page, rect1)).pins;
  await rowByText(page, /deleted a rectangle/).click();
  await page.waitForTimeout(1500);
  const g75 = await highlightInfo(page, null);
  await page.screenshot({ path: `${OUT_DIR}/75-ghost.png` });
  const pin = page.locator('#document-history-overlay .dh-restore-pin').first();
  if (await pin.count()) await pin.click();
  else await page.locator('[data-testid^="document-history-restore-"]').first().click();
  const back = await waitFor(async () => {
    const w = (await windowMarks(page)).filter((m) => m.id === rect2).length;
    const s = (await serverMarks(backend)).filter((m) => m.id === rect2).length;
    return w === 1 && s === 1 ? { w, s } : null;
  }, { timeout: 10_000 });
  await page.waitForTimeout(1200);
  const afterRestore = await feed(page);
  const restoredRow = afterRestore.rows.find((r) => r.status === 'restored');
  await page.screenshot({ path: `${OUT_DIR}/75-restored.png` });
  const ok75 = g75.ghosts >= 1 && g75.pins === 1 && restoreOnNonDelete === 0 && Boolean(back)
    && (await windowMarks(page)).filter((m) => m.id === rect2).length === 1;
  report('75', ok75 ? 'PASS' : 'FAIL', `deleted line: ghost=${g75.ghosts} (dash ${g75.ghostDash}), Restore on page=${g75.pins} ("${g75.pinText}"); Restore offered on a non-delete line=${restoreOnNonDelete}; after Restore copies in window/server=${back ? `${back.w}/${back.s}` : 'not back'}; restored line="${restoredRow?.text}"; shots=75-ghost.png/75-restored.png`);

  // ---- 76 Restore again does not overwrite or duplicate
  await page.mouse.click(5, 450);
  const leftBefore = (await serverMarks(backend)).find((x) => x.id === rect2)?.left;
  const grab = await pickMark(page, rect2);
  await page.mouse.move(grab.x + grab.w * 0.3, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + grab.w * 0.3 + 30, grab.y, { steps: 4 });
  await page.mouse.move(grab.x + grab.w * 0.3 + 60, grab.y, { steps: 4 });
  await page.mouse.up();
  const movedLeft = await waitFor(async () => { const m = (await serverMarks(backend)).find((x) => x.id === rect2); return m && m.left > leftBefore + 2 ? m.left : null; }, { timeout: 8000 });
  await page.mouse.click(5, 450);
  await rowByText(page, /deleted a rectangle/).click();
  await page.waitForTimeout(1500);
  const offered = (await page.locator('[data-testid^="document-history-restore-"]').count()) + (await highlightInfo(page, rect2)).pins;
  const backNote = await page.locator('.dh-note').filter({ hasText: /Back on the page/ }).count();
  if (offered) {
    const p2 = page.locator('#document-history-overlay .dh-restore-pin').first();
    if (await p2.count()) await p2.click(); else await page.locator('[data-testid^="document-history-restore-"]').first().click();
    await page.waitForTimeout(2000);
  }
  const after76 = (await serverMarks(backend)).filter((m) => m.id === rect2);
  const win76 = (await windowMarks(page)).filter((m) => m.id === rect2);
  const ok76 = Boolean(movedLeft) && after76.length === 1 && win76.length === 1 && Math.abs(after76[0].left - movedLeft) < 0.75;
  report('76', ok76 ? 'PASS' : 'FAIL', `after moving the restored mark to left=${movedLeft}: Restore still offered=${offered} ("Back on the page now" shown=${backNote > 0}); copies window/server=${win76.length}/${after76.length}; left stays ${after76[0]?.left}`);

  // ---- 78 pick a mark narrows the list; Escape restores it
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 450);
  await page.waitForTimeout(500);
  const full = await feed(page);
  await pickMark(page, rect1);
  await page.waitForTimeout(1200);
  const narrowed = await feed(page);
  await page.screenshot({ path: `${OUT_DIR}/78-picked.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const restored = await feed(page);
  const ok78 = Boolean(narrowed.markChip) && /Showing history for this/i.test(narrowed.markChip)
    && narrowed.rows.length > 0 && narrowed.rows.every((r) => r.mark === rect1) && narrowed.rows.length < full.rows.length
    && !restored.markChip && restored.rows.length >= full.rows.length - 1;
  report('78', ok78 ? 'PASS' : 'FAIL', `picked rectangle 1: chip="${narrowed.markChip}", lines ${full.rows.length} -> ${narrowed.rows.length} (all that mark=${narrowed.rows.every((r) => r.mark === rect1)}); Esc -> chip gone=${!restored.markChip}, lines=${restored.rows.length}; shot=78-picked.png`);

  // ---- 80 dots, key, ghost style; undo rows grey
  await undo(page); // makes an undo line (known choice: grey dot)
  await page.waitForTimeout(1500);
  const f80 = await feed(page);
  const byStatus = {};
  for (const r of f80.rows) byStatus[r.status] = byStatus[r.status] || r.dot;
  const dotsOk = ['created', 'edited', 'deleted', 'restored'].every((s) => byStatus[s] === COLORS[s]);
  const legendOk = f80.legend.length === 4 && f80.legend.every((l) => l.color === COLORS[l.status]) && f80.legendBelowChips;
  const ghostOk = g75.ghostDash && /4/.test(g75.ghostDash) && g75.pins === 1 && g75.pinBg === 'rgba(0, 0, 0, 0)';
  const ok80 = dotsOk && legendOk && ghostOk && ok80hl;
  await page.screenshot({ path: `${OUT_DIR}/80-clean-up.png` });
  report('80', ok80 ? 'PASS' : 'FAIL', `dots ${JSON.stringify(byStatus)}; key=${f80.legend.map((l) => `${l.label}:${l.color}`).join(',')} under filters=${f80.legendBelowChips}; highlight washes=${h74.washes} outlines=${h74.lines} fully around=${surrounds(h74)} pads=${JSON.stringify(pads(h74))} looping animations=${steady1.infiniteAnims} outline still over 0.7 s=${JSON.stringify(steady1.outline) === JSON.stringify(steady2.outline)}; ghost dash="${g75.ghostDash}" one Restore=${g75.pins === 1} pin background=${g75.pinBg}; undo line dot=${byStatus.other || 'none'}; shot=80-clean-up.png`);

  // ---- 77 is its own document (below). Evidence of database traffic:
  // eslint-disable-next-line no-console
  console.log(`[fake backend] ${backend.summary().join(', ')}`);
  await context.close();
  expect(errors).toEqual([]);
  expect({ ok73, ok74, ok75, ok76, ok78, ok80 }).toEqual({ ok73: true, ok74: true, ok75: true, ok76: true, ok78: true, ok80: true });
});

test('77 [HI1] Load older pages back with no repeats or gaps', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000077';
  const backend = new FakeBackend({ documentId: docId });
  const SEEDED = 130;
  backend.table('document_history_events').push(...otherPersonRows(docId, SEEDED, { startMs: Date.now() - 6 * 3600_000, stepMs: 47 * 60_000, prefix: 'old' }));
  const { context, page, errors } = await openWindow(browser, backend, docId, PDF);
  await openHistory(page);
  const firstPage = (await feed(page)).rows.length;
  const more = page.locator('[data-testid="document-history-load-older"]');
  let clicks = 0;
  while (await more.count() && clicks < 10) {
    await more.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT_DIR}/77-before-load-older-${clicks + 1}.png` });
    await more.first().click();
    clicks += 1;
    await page.waitForTimeout(1200);
  }
  const f = await feed(page);
  const ids = f.rows.map((r) => r.id);
  const unique = new Set(ids);
  const days = f.days;
  const seededShown = f.rows.filter((r) => /\bSam\b/.test(r.text)).length;
  const ok = firstPage < SEEDED && clicks >= 1 && unique.size === ids.length && seededShown === SEEDED
    && new Set(days).size === days.length && errors.length === 0;
  report('77', ok ? 'PASS' : 'FAIL', `${SEEDED} older lines on the server; first page showed ${firstPage}; pressed Load older ${clicks}x; now ${f.rows.length} lines, ${unique.size} distinct (repeats=${ids.length - unique.size}), Sam's lines ${seededShown}/${SEEDED} (gaps=${SEEDED - seededShown}); day headings ${JSON.stringify(days)}; shot=77-before-load-older-1.png`);
  await context.close();
  expect(ok).toBe(true);
});

for (const engine of ['chromium', 'webkit']) {
  test(`79 [HI2] phone History: a tap on the page picks the mark (${engine})`, async ({ browser }) => {
    const docId = `7e57d0c0-0000-4000-8000-0000000079${engine === 'webkit' ? '02' : '01'}`;
    const backend = new FakeBackend({ documentId: docId });
    // A desktop window makes the rectangle; the phone opens the same document.
    const desk = await openWindow(browser, backend, docId, PDF);
    await drawRect(desk.page, 1, 120, 300, 300, 440);
    await waitFor(async () => (await serverMarks(backend)).length === 1, { timeout: 20_000 });
    await desk.context.close();
    // (the test-level Chromium path would otherwise be handed to WebKit too)
    const phoneBrowser = engine === 'webkit'
      ? await webkit.launch({ executablePath: process.env.PW_WEBKIT_PATH || '/opt/pw-browsers/webkit-2272/pw_run.sh' })
      : browser;
    const { context, page, errors } = await openWindow(phoneBrowser, backend, docId, PDF, { device: engine === 'webkit' ? PHONE_WEBKIT : PHONE, phone: true });
    const rect = await waitFor(async () => (await windowMarks(page))[0], { timeout: 20_000 });
    await openHistory(page);
    const sheet = page.locator('.dh-panel--phone').first();
    const sheetBox = await sheet.boundingBox();
    await page.screenshot({ path: `${OUT_DIR}/79-${engine}-open.png` });
    // Tap the rectangle's top edge where the sheet does not cover it.
    const target = await page.evaluate((id) => {
      const g = document.querySelector(`[data-anno-id="${CSS.escape(id)}"]`);
      const r = g.getBoundingClientRect();
      return { x: r.left + r.width * 0.3, y: r.top, box: [r.left, r.top, r.width, r.height] };
    }, rect.id);
    const covered = sheetBox && target.y >= sheetBox.y;
    const hit = await page.evaluate(({ x, y }) => {
      const e = document.elementFromPoint(x, y);
      return e ? `${e.tagName}.${String(e.className?.baseVal ?? e.className).slice(0, 40)}` : null;
    }, target);
    const dimmed = await page.evaluate(() => [...document.querySelectorAll('body *')].some((e) => {
      const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
      return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.4 && cs.position === 'fixed' && /rgba?\(0, 0, 0, 0\.[1-9]/.test(cs.backgroundColor);
    }));
    await page.touchscreen.tap(target.x, target.y);
    await page.waitForTimeout(1500);
    const f = await feed(page);
    const sheetStill = await sheet.isVisible();
    await page.screenshot({ path: `${OUT_DIR}/79-${engine}-tapped.png` });
    const ok = !covered && !dimmed && sheetStill && Boolean(f.markChip) && f.rows.length > 0 && f.rows.every((r) => r.mark === rect.id) && errors.length === 0;
    report('79', ok ? 'PASS' : 'FAIL', `${engine} 390x844: sheet top=${Math.round(sheetBox?.y ?? -1)}, page under it dimmed=${dimmed}; tapped mark at y=${Math.round(target.y)} (element there: ${hit}); sheet still open=${sheetStill}; list narrowed to it: "${f.markChip}" (${f.rows.length} lines); errors=${errors.length}; shots=79-${engine}-open/tapped.png`, `phone-${engine}`);
    await context.close();
    if (engine === 'webkit') await phoneBrowser.close();
    expect(ok).toBe(true);
  });
}
