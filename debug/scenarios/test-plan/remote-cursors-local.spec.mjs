// KAL-399 — live remote cursors, two people on one document, LOCAL backend.
//
// Two browser contexts (two people: 'dev-test-user' = Dev Test User and
// 'dev-test-user-b' = Bo Reed) open the same document against
// tp-fake-backend.mjs: an in-memory Supabase stand-in inside the Playwright
// process that relays the document's live channel between the windows. No
// network, no database. The app code under test is the real one (doc handle,
// live channel, useLiveCursorBroadcast, RemoteCursorLayer).
//
// Checks:
//   * A's mouse on page 1 shows on B at the same spot of the page, at two
//     zoom levels on B and with A zoomed differently; label + colour;
//   * alone on the document: no message during a sweep; when B joins, A's
//     resting point goes out at once; when the last other leaves, it stops;
//   * traffic: messages per second while A sweeps the mouse, and how smooth
//     the arrow moves on B (share of frames it moves on);
//   * leave (mouse off the pages), idle (still for 5 s) and close (A's window
//     goes) each take the cursor away;
//   * phone (390 x 844, touch): A's cursor shows on the phone at the right
//     spot at two zoom levels; the phone's finger shows on A only while it
//     touches (+ a short linger), never while just reading.
// Run (not in CI; .env needs VITE_SUPABASE_URL/KEY so the client exists):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5399 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/remote-cursors-local.spec.mjs
import { test, expect } from '@playwright/test';
import { PHONE, pageFrame } from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import { openWindow, waitFor } from './tp-actions.mjs';
import { PNG } from 'pngjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 300_000 });

const OUT = process.env.KAL399_OUT
  || '/tmp/claude-0/-home-user-Survey/9b0de99e-8c5f-5afb-8f1e-4b0f6be9fab7/scratchpad/kal399';
const PDF = 'clickable-link-test.pdf'; // small: the cursors do not need a heavy drawing
const DESK = { device: { viewport: { width: 1440, height: 900 } } };
const B_USER = {
  id: 'dev-test-user-b',
  email: 'bo.reed@example.invalid',
  user_metadata: { first_name: 'Bo', last_name: 'Reed', full_name: 'Bo Reed' },
};
const log = (...args) => console.log('[kal399]', ...args);

// The remote cursors B shows: page, page point, and where the arrow's tip is
// on screen.
async function remoteCursors(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-remote-cursor="true"]')].map((el) => {
    const layer = el.closest('[data-live-cursor-layer="true"]');
    const r = el.getBoundingClientRect();
    const label = el.querySelector('.remote-cursor__label');
    return {
      page: Number(layer?.getAttribute('data-page')),
      x: Number(el.getAttribute('data-remote-cursor-x')),
      y: Number(el.getAttribute('data-remote-cursor-y')),
      tip: [r.left, r.top],
      leaving: el.getAttribute('data-leaving') === 'true',
      user: el.getAttribute('data-remote-cursor-user'),
      label: label?.textContent || '',
      labelBox: label ? (({ left, top, width, height }) => ({ x: left, y: top, width, height }))(label.getBoundingClientRect()) : null,
      fill: getComputedStyle(label).backgroundColor,
      opacity: Number(getComputedStyle(el).opacity),
      // A glide or fade still running (CSS transitions are animations).
      moving: el.getAnimations().some((a) => a.playState === 'running'),
    };
  }));
}

// Is the name tag really painted on top (not hidden under marks or the page)?
// Share of the tag's pixels that are the person's colour, from a screenshot.
async function paintedShare(page, cursor) {
  const box = cursor?.labelBox;
  if (!box || !(box.width > 2)) return 0;
  const clip = { x: Math.round(box.x + 3), y: Math.round(box.y + 3), width: Math.max(1, Math.round(box.width - 6)), height: Math.max(1, Math.round(box.height - 6)) };
  const png = PNG.sync.read(await page.screenshot({ clip }));
  const [r, g, b] = cursor.fill.match(/\d+/g).map(Number);
  let hit = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (Math.abs(png.data[i] - r) + Math.abs(png.data[i + 1] - g) + Math.abs(png.data[i + 2] - b) < 40) hit += 1;
  }
  return hit / (png.data.length / 4);
}

// Wait until the cursor's glide has finished (tip stops moving).
async function settledCursor(page, predicate = () => true, timeout = 6000) {
  let last = null;
  return waitFor(async () => {
    const c = (await remoteCursors(page)).find((entry) => !entry.leaving && predicate(entry));
    if (!c || c.moving) { last = null; return null; }
    const same = last && Math.abs(last.tip[0] - c.tip[0]) < 0.05 && Math.abs(last.tip[1] - c.tip[1]) < 0.05;
    last = c;
    return same ? c : null;
  }, { timeout, every: 60 });
}

async function zoomTo(page, percent) {
  await page.bringToFront();
  const input = page.getByRole('textbox', { name: /zoom percentage/i }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole('button', { name: 'Edit zoom percentage' }).first().click();
    if (await input.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) {
      await input.fill(String(percent));
      log('zoom field', await input.inputValue());
      await input.press('Enter');
      break;
    }
  }
  await page.waitForTimeout(1200);
}

const zoomLabel = (page) => page.getByRole('button', { name: 'Edit zoom percentage' }).first().textContent().catch(() => '?');

// Phone zoom: a real two-finger pinch through Chromium's touch emulation.
async function pinch(page, scaleFactor) {
  const cdp = await page.context().newCDPSession(page);
  const vp = page.viewportSize();
  await cdp.send('Input.synthesizePinchGesture', {
    x: Math.round(vp.width / 2), y: Math.round(vp.height / 2), scaleFactor, relativeSpeed: 600, gestureSourceType: 'touch',
  });
  await page.waitForTimeout(1500);
}

// Put page 1's point (px, py) in view on this window.
async function bringIntoView(page, n, px, py) {
  await page.evaluate(({ n: num, px: x, py: y }) => {
    const el = document.querySelector(`.survey-pdfjs-page-div[data-page-number="${num}"]`);
    const layer = el?.querySelector('[data-live-cursor-layer="true"]');
    const w = Number(layer?.getAttribute('data-page-width'));
    const r = el.getBoundingClientRect();
    const sx = r.left + (x / w) * r.width;
    const sy = r.top + (y / w) * r.width;
    let scroller = el.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    if (!scroller) return;
    scroller.scrollTop += sy - innerHeight / 2;
    scroller.scrollLeft += sx - innerWidth / 2;
  }, { n, px, py });
  await page.waitForTimeout(700);
}

async function moveMouseTo(page, n, px, py, steps = 6) {
  const frame = await pageFrame(page, n);
  const [sx, sy] = frame.toScreen(px, py);
  await page.mouse.move(sx, sy, { steps });
  return { frame, sx, sy };
}

async function tipError(viewer, n, cursor) {
  const frame = await pageFrame(viewer, n);
  const [ex, ey] = frame.toScreen(cursor.x, cursor.y);
  return { err: Math.hypot(cursor.tip[0] - ex, cursor.tip[1] - ey), expected: [ex, ey], scale: frame.scale };
}

const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

async function twoPeople(browser, docId, bOpts = DESK, { beforeB = null, backend: given = null } = {}) {
  const backend = given || new FakeBackend({ documentId: docId });
  backend.seedDocumentCollaborator({ userId: B_USER.id, role: 'editor', email: B_USER.email });
  const A = await openWindow(browser, backend, docId, PDF, DESK);
  if (beforeB) await beforeB(A, backend);
  const B = await openWindow(browser, backend, docId, PDF, { ...bOpts, user: B_USER });
  return { backend, A, B };
}

// When each person's presence row (the people list's document_presence)
// first appears, and a way to take one away (as the close cleanup or the
// 2-minute age-out does).
function watchPresence(backend) {
  const joinedAt = new Map();
  const emit = backend.emitChange.bind(backend);
  backend.emitChange = (table, type, record, old) => {
    if (table === 'document_presence' && record?.user_id && !joinedAt.has(record.user_id)) joinedAt.set(record.user_id, Date.now());
    return emit(table, type, record, old);
  };
  return {
    joinedAt,
    remove(userId) {
      const rows = backend.table('document_presence');
      const gone = rows.filter((r) => r.user_id === userId);
      backend.tables.set('document_presence', rows.filter((r) => r.user_id !== userId));
      for (const row of gone) emit('document_presence', 'DELETE', null, row);
      return gone.length;
    },
  };
}

// A mouse sweep over page 1 of this window (~60 moves, ~1 s on a quiet machine).
async function sweep(page, from = [100, 200], moves = 60) {
  const frame = await pageFrame(page, 1);
  const t0 = Date.now();
  for (let i = 0; i < moves; i += 1) {
    const [sx, sy] = frame.toScreen(from[0] + i * 4, from[1] + i * 2);
    await page.mouse.move(sx, sy);
    await page.waitForTimeout(16);
  }
  return Date.now() - t0;
}

// Count the cursor messages (v5) the fake Realtime relays, and their size.
function watchCursorTraffic(backend) {
  const stats = { messages: 0, bytes: 0, maxBytes: 0, times: [] };
  const relay = backend.relayBroadcast.bind(backend);
  backend.relayBroadcast = (from, topic, body) => {
    if (body?.payload?.v === 5) {
      const bytes = JSON.stringify(body.payload).length;
      stats.messages += 1;
      stats.times.push(Date.now());
      stats.bytes += bytes;
      stats.maxBytes = Math.max(stats.maxBytes, bytes);
    }
    return relay(from, topic, body);
  };
  return stats;
}

test('desktop: alone sends nothing; A points, B sees it at the right spot at two zooms; leave, idle and close take it away', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000399';
  const results = {};
  const fresh = new FakeBackend({ documentId: docId });
  const traffic = watchCursorTraffic(fresh);
  const people = watchPresence(fresh);

  // 0) A alone on the document: a mouse sweep sends nothing. Then B opens
  //    it while A's mouse rests on the page: A's point goes out at once.
  const { backend, A, B } = await twoPeople(browser, docId, DESK, {
    backend: fresh,
    beforeB: async (alone) => {
      await alone.page.waitForTimeout(1500);
      const ms = await sweep(alone.page);
      await alone.page.waitForTimeout(500);
      results.alone = { sweepMs: ms, messages: traffic.messages };
      log('alone', results.alone);
    },
  });
  expect(results.alone.messages, 'alone on the document: no cursor messages').toBe(0);
  const bJoined = people.joinedAt.get(B_USER.id);
  const firstAfterJoin = traffic.times.find((t) => t >= bJoined);
  results.join = { firstMessageMsAfterBJoined: firstAfterJoin ? firstAfterJoin - bJoined : null };
  log('join', results.join);
  expect(firstAfterJoin, 'B joined: A\'s resting point is sent').toBeTruthy();
  expect(firstAfterJoin - bJoined).toBeLessThan(1500);

  // 1) A points at page 1 (300, 400) pt; B at its default zoom.
  await moveMouseTo(A.page, 1, 300, 400);
  let c = await settledCursor(B.page);
  expect(c, 'B shows A\'s cursor').toBeTruthy();
  let e = await tipError(B.page, 1, c);
  results.zoom1 = { zoomB: await zoomLabel(B.page), point: [c.x, c.y], errPx: +e.err.toFixed(2), tip: c.tip, expected: e.expected, label: c.label, user: c.user };
  log('B zoom 1', results.zoom1);
  expect(c.page).toBe(1);
  expect(Math.abs(c.x - 300)).toBeLessThan(1);
  expect(Math.abs(c.y - 400)).toBeLessThan(1);
  expect(e.err).toBeLessThan(1.5);
  expect(c.label).toBe('Dev');
  expect(c.user).toBe('dev-test-user');
  await B.page.screenshot({ path: `${OUT}/after-desktop-B-zoom1.png` });
  results.zoom1.painted = +(await paintedShare(B.page, c)).toFixed(2);
  expect(results.zoom1.painted, 'the name tag is painted on top').toBeGreaterThan(0.5);

  // Colour = the person's pastel, the same as their face in B's people list
  // (assignUserColors over the document's people, B keeps his own).
  // (Imported in B's page: Playwright's loader reads src/*.js as CommonJS.)
  const colours = await B.page.evaluate(async () => {
    const m = await import('/src/utils/userColors.js');
    return { a: m.assignUserColors(['dev-test-user', 'dev-test-user-b'], 'dev-test-user-b').get('dev-test-user').fill };
  });
  results.colour = { shown: c.fill, expected: rgb(colours.a) };
  expect(c.fill).toBe(rgb(colours.a));

  // 2) B zooms to 200 %; A (at its own zoom) points somewhere else.
  await zoomTo(B.page, 200);
  await bringIntoView(B.page, 1, 450, 300);
  await moveMouseTo(A.page, 1, 450, 300);
  c = await settledCursor(B.page, (entry) => Math.abs(entry.x - 450) < 1);
  expect(c, 'B shows A\'s cursor after zoom').toBeTruthy();
  e = await tipError(B.page, 1, c);
  results.zoom2 = { zoomB: await zoomLabel(B.page), point: [c.x, c.y], errPx: +e.err.toFixed(2), pageScale: +e.scale.toFixed(3) };
  log('B zoom 2', results.zoom2);
  expect(e.err).toBeLessThan(1.5);
  await B.page.screenshot({ path: `${OUT}/after-desktop-B-zoom200.png` });
  // (450, 300) is on the big red mark: the cursor must be drawn over it.
  results.zoom2.painted = +(await paintedShare(B.page, c)).toFixed(2);
  log('B zoom 2 painted', results.zoom2.painted, c.tip);
  expect(results.zoom2.painted, 'the name tag is painted over the marks').toBeGreaterThan(0.5);

  // 3) A zooms (150 %; 101 % = whole page is this screen's floor) — the page
  // point it sends must not change meaning.
  await zoomTo(A.page, 150);
  const zoomA = await zoomLabel(A.page);
  log('A zoom label', zoomA);
  await A.page.screenshot({ path: `${OUT}/after-desktop-A-zoom150.png` });
  expect(zoomA).toMatch(/(^|%)150%$/);
  await bringIntoView(A.page, 1, 120, 180);
  await moveMouseTo(A.page, 1, 120, 180);
  c = await settledCursor(B.page, (entry) => Math.abs(entry.x - 120) < 1);
  if (!c) {
    await bringIntoView(B.page, 1, 120, 180);
    c = await settledCursor(B.page, (entry) => Math.abs(entry.x - 120) < 1);
  }
  expect(c).toBeTruthy();
  await bringIntoView(B.page, 1, 120, 180);
  c = await settledCursor(B.page, (entry) => Math.abs(entry.x - 120) < 1);
  e = await tipError(B.page, 1, c);
  results.zoomA = { zoomA: await zoomLabel(A.page), point: [c.x, c.y], errPx: +e.err.toFixed(2) };
  log('A zoomed', results.zoomA);
  expect(Math.abs(c.x - 120)).toBeLessThan(1);
  expect(Math.abs(c.y - 180)).toBeLessThan(1);
  expect(e.err).toBeLessThan(1.5);

  // 4) Traffic: A sweeps the mouse for ~1 s (60 moves) — count messages;
  //    meanwhile B records where the arrow is on every frame (smoothness).
  await bringIntoView(B.page, 1, 220, 260);
  await B.page.evaluate(() => {
    const samples = [];
    window.__kal399Frames = samples;
    const tick = () => {
      const el = document.querySelector('[data-remote-cursor="true"]');
      const r = el?.getBoundingClientRect();
      samples.push(r ? [performance.now(), r.left, r.top] : [performance.now(), NaN, NaN]);
      if (window.__kal399Frames === samples) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const before = traffic.messages;
  const beforeBytes = traffic.bytes;
  const ms = await sweep(A.page);
  await A.page.waitForTimeout(300);
  const sent = traffic.messages - before;
  const frames = await B.page.evaluate(() => { const f = window.__kal399Frames; window.__kal399Frames = null; return f; });
  // Frames from the first move to the last: how many show the arrow moving,
  // the longest run of still frames, and the biggest jump in one frame.
  const seen = frames.filter((f) => Number.isFinite(f[1]));
  let firstMove = -1;
  let lastMove = -1;
  for (let i = 1; i < seen.length; i += 1) {
    if (Math.hypot(seen[i][1] - seen[i - 1][1], seen[i][2] - seen[i - 1][2]) > 0.05) { if (firstMove < 0) firstMove = i; lastMove = i; }
  }
  let moving = 0;
  let stillRun = 0;
  let longestStill = 0;
  let maxJump = 0;
  for (let i = Math.max(1, firstMove); i <= lastMove; i += 1) {
    const d = Math.hypot(seen[i][1] - seen[i - 1][1], seen[i][2] - seen[i - 1][2]);
    maxJump = Math.max(maxJump, d);
    if (d > 0.05) { moving += 1; stillRun = 0; } else { stillRun += 1; longestStill = Math.max(longestStill, stillRun); }
  }
  const span = Math.max(1, lastMove - Math.max(1, firstMove) + 1);
  results.traffic = {
    moves: 60, ms, messages: sent, perSecond: +(sent / ((ms + 300) / 1000)).toFixed(1),
    avgBytes: Math.round((traffic.bytes - beforeBytes) / Math.max(1, sent)), maxBytes: traffic.maxBytes,
  };
  results.smooth = {
    frames: span, movingShare: +(moving / span).toFixed(2), longestStillFrames: longestStill,
    frameMs: +((seen[lastMove]?.[0] - seen[Math.max(1, firstMove)]?.[0]) / span).toFixed(1), maxJumpPx: +maxJump.toFixed(1),
  };
  log('traffic', results.traffic, 'smooth', results.smooth);
  expect(sent / ((ms + 300) / 1000)).toBeLessThanOrEqual(11);

  // 5) Leave: A's mouse goes to the top toolbar (off the pages).
  await A.page.mouse.move(700, 8, { steps: 3 });
  const tLeave = Date.now();
  const gone = await waitFor(async () => (await remoteCursors(B.page)).length === 0, { timeout: 3000, every: 30 });
  results.leaveMs = Date.now() - tLeave;
  log('leave', gone, results.leaveMs);
  expect(gone).toBe(true);

  // 6) Idle: A points, then holds still: the cursor fades after ~5 s.
  await moveMouseTo(A.page, 1, 200, 220);
  await settledCursor(B.page);
  const tIdle = Date.now();
  const idleFading = await waitFor(async () => (await remoteCursors(B.page))[0]?.leaving === true, { timeout: 8000, every: 100 });
  results.idleFadeMs = Date.now() - tIdle;
  await B.page.screenshot({ path: `${OUT}/after-desktop-B-idle-fading.png` });
  const idleGone = await waitFor(async () => (await remoteCursors(B.page)).length === 0, { timeout: 3000, every: 50 });
  log('idle', idleFading, idleGone, results.idleFadeMs);
  expect(idleFading && idleGone).toBe(true);
  expect(results.idleFadeMs).toBeGreaterThan(4000);

  // A moves again -> back.
  await moveMouseTo(A.page, 1, 260, 260);
  expect(await settledCursor(B.page)).toBeTruthy();

  // 7) Close: A's window goes away -> gone without waiting for idle.
  const tClose = Date.now();
  await A.context.close();
  const closed = await waitFor(async () => (await remoteCursors(B.page)).length === 0, { timeout: 7000, every: 30 });
  results.closeMs = Date.now() - tClose;
  log('close', closed, results.closeMs);
  expect(closed).toBe(true);

  // 8) The last other person leaves. A's window is gone but its presence row
  //    stays until the cleanup / age-out, so B still sends while it is there
  //    (proof the gate is what stops it), and nothing once it goes.
  let mark = traffic.messages;
  await sweep(B.page, [120, 220], 30);
  await B.page.waitForTimeout(300);
  results.lastLeaves = { whileAPresent: traffic.messages - mark };
  expect(people.remove('dev-test-user'), 'A had a presence row').toBeGreaterThan(0);
  await B.page.waitForTimeout(1000);
  mark = traffic.messages;
  await sweep(B.page, [130, 230], 60);
  await B.page.waitForTimeout(500);
  results.lastLeaves.afterALeft = traffic.messages - mark;
  log('last leaves', results.lastLeaves);
  expect(results.lastLeaves.whileAPresent).toBeGreaterThan(0);
  expect(results.lastLeaves.afterALeft, 'alone again: no cursor messages').toBe(0);
  results.errors = [...A.errors, ...B.errors];
  log('RESULT', JSON.stringify(results));
  await B.context.close();
  expect(results.errors).toEqual([]);
});

test('phone: B (390x844, touch) sees A at the right spot at two zooms; B\'s finger shows on A only while touching', async ({ browser }) => {
  const { backend, A, B } = await twoPeople(browser, '7e57d0c0-0000-4000-8000-000000000400', { device: PHONE, phone: true });
  const results = {};

  // B's phone at its fit zoom; A points at (306, 260).
  await moveMouseTo(A.page, 1, 306, 260);
  let c = await settledCursor(B.page);
  expect(c, 'phone shows A\'s cursor').toBeTruthy();
  let e = await tipError(B.page, 1, c);
  results.phoneZoom1 = { point: [c.x, c.y], errPx: +e.err.toFixed(2), pageScale: +e.scale.toFixed(3), label: c.label };
  log('phone zoom 1', results.phoneZoom1);
  expect(e.err).toBeLessThan(1.5);
  await B.page.screenshot({ path: `${OUT}/after-phone-B-zoom1.png` });
  results.phoneZoom1.painted = +(await paintedShare(B.page, c)).toFixed(2);
  expect(results.phoneZoom1.painted).toBeGreaterThan(0.5);

  // Phone pinches in (x2), A points again near the middle of the page.
  await pinch(B.page, 2);
  await bringIntoView(B.page, 1, 306, 300);
  await moveMouseTo(A.page, 1, 306, 300);
  c = await settledCursor(B.page, (entry) => Math.abs(entry.y - 300) < 1);
  expect(c).toBeTruthy();
  e = await tipError(B.page, 1, c);
  results.phoneZoom2 = { point: [c.x, c.y], errPx: +e.err.toFixed(2), pageScale: +e.scale.toFixed(3) };
  log('phone zoom 2', results.phoneZoom2);
  expect(e.scale).toBeGreaterThan(results.phoneZoom1.pageScale * 1.3);
  expect(e.err).toBeLessThan(1.5);
  await B.page.screenshot({ path: `${OUT}/after-phone-B-zoom2.png` });
  results.phoneZoom2.painted = +(await paintedShare(B.page, c)).toFixed(2);
  expect(results.phoneZoom2.painted).toBeGreaterThan(0.5);

  // A's mouse leaves the pages -> the phone's copy goes.
  await A.page.mouse.move(700, 8, { steps: 3 });
  expect(await waitFor(async () => (await remoteCursors(B.page)).length === 0, { timeout: 3000, every: 30 })).toBe(true);

  // The phone just reading (scrolled, no touch on the page for a while): A sees nothing.
  await B.page.waitForTimeout(1500);
  expect((await remoteCursors(A.page)).length).toBe(0);

  // The phone's finger touches the page and holds: A sees it there.
  const pf = await pageFrame(B.page, 1);
  const vp = B.page.viewportSize();
  const tx = vp.width / 2;
  const ty = vp.height / 2;
  const cdp = await B.page.context().newCDPSession(B.page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx + 1, y: ty + 1, id: 1 }] });
  const expectX = (tx + 1 - pf.box.x) / pf.scale;
  const expectY = (ty + 1 - pf.box.y) / pf.scale;
  c = await settledCursor(A.page);
  results.phoneTouch = c ? { shownOnA: [c.x, c.y], expected: [+expectX.toFixed(1), +expectY.toFixed(1)], label: c.label } : null;
  log('phone touch', results.phoneTouch);
  expect(c).toBeTruthy();
  expect(c.label).toBe('Bo');
  if (c.page === 1) {
    expect(Math.abs(c.x - expectX)).toBeLessThan(2);
    expect(Math.abs(c.y - expectY)).toBeLessThan(2);
    await bringIntoView(A.page, 1, c.x, c.y);
    const onA = await settledCursor(A.page);
    const ea = await tipError(A.page, 1, onA);
    results.phoneTouch.errPxOnA = +ea.err.toFixed(2);
    expect(ea.err).toBeLessThan(1.5);
  }
  await A.page.screenshot({ path: `${OUT}/after-desktop-A-sees-phone-finger.png` });
  // Lift: it lingers ~1.5 s, then goes.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const tLift = Date.now();
  const lifted = await waitFor(async () => (await remoteCursors(A.page)).length === 0 || (await remoteCursors(A.page))[0].leaving, { timeout: 5000, every: 30 });
  results.phoneLiftGoneMs = Date.now() - tLift;
  log('phone lift', lifted, results.phoneLiftGoneMs);
  expect(lifted).toBe(true);
  expect(results.phoneLiftGoneMs).toBeGreaterThan(1000);
  expect(results.phoneLiftGoneMs).toBeLessThan(3000);
  results.errors = [...A.errors, ...B.errors];
  log('RESULT', JSON.stringify(results));
  await A.context.close();
  await B.context.close();
  expect(results.errors).toEqual([]);
});
