// KAL-399 (2026-10-13): live cursors — where the other people in the same
// document are pointing.
//
// Pins:
//   * coordinates: a screen point becomes page units through the page box
//     measured on screen (container-aware), so the same spot of the page gives
//     the same page point at any zoom, and the receiver puts it back at the
//     same percent of its own page box;
//   * the sender: one message at once, then at most one per
//     LIVE_CURSOR_INTERVAL_MS (~10 a second) however many pointer events,
//     the last position always lands, nothing for a still pointer or a tiny
//     move, nothing without a live channel, one "gone" when the pointer
//     leaves the pages and on dispose, and only if a cursor was showing;
//   * the presence gate: alone on the document = no message and no timer;
//     someone else joins -> it starts (the current point at once); the last
//     one leaves -> it stops; the same person's other device does not count;
//   * who-this-is (user id + name) rides on the first message and every
//     LIVE_CURSOR_IDENTITY_MS after, so most messages are ~100 bytes, and a
//     receiver that missed it learns it within that time;
//   * the receiver: shows, moves, ignores itself and junk, caps, fades out on
//     "gone" and after LIVE_CURSOR_IDLE_MS idle, comes back on a new move;
//   * end to end through two doc handles on the fake live channel: a cursor
//     message reaches the other screen and nothing is ever written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LIVE_CURSOR_FADE_MS,
  LIVE_CURSOR_IDENTITY_MS,
  LIVE_CURSOR_IDLE_MS,
  LIVE_CURSOR_INTERVAL_MS,
  LIVE_CURSOR_MAX,
  LIVE_CURSOR_RECEIVE_PER_SEC,
  LIVE_CURSOR_VERSION,
  __liveCursorsTest,
  applyRemoteLiveCursor,
  clearLiveCursors,
  clientPointToPagePoint,
  createLiveCursorSender,
  cursorLabel,
  getLiveCursorsForPage,
  hasLiveCursorSink,
  hasOtherPeoplePresent,
  pagePointToPercent,
  setLiveCursorSink,
  sweepLiveCursors,
} from '../src/services/annotationLiveCursors.js';
import { createCloud, openFor, settle, until } from './helpers/liveSyncFakeCloud.mjs';

function fakeClock() {
  let now = 1_000;
  const timers = [];
  return {
    now: () => now,
    setTimer: (fn, ms) => { const timer = { at: now + ms, fn }; timers.push(timer); return timer; },
    clearTimer: (timer) => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); },
    pending: () => timers.length,
    advance(ms) {
      now += ms;
      for (;;) {
        timers.sort((l, r) => l.at - r.at);
        if (!timers.length || timers[0].at > now) break;
        timers.shift().fn();
      }
    },
  };
}

// A Letter page (612 x 792 pt) and its page box on screen at a given zoom.
const LETTER = { width: 612, height: 792 };
const pageAt = (zoom, left = 100, top = 50, page = 1) => ({
  page, rect: { left, top, width: LETTER.width * zoom, height: LETTER.height * zoom }, size: LETTER,
});

test('coordinates: the same spot of the page is the same page point at any zoom, and lands back on that spot', () => {
  // The spot 306 x 198 pt (middle, a quarter down) on screen at 50%, 100%,
  // 200% and through an odd Electron-style factor (4/3).
  for (const zoom of [0.5, 1, 2, 4 / 3]) {
    const box = pageAt(zoom, 37.5, 12.25);
    const sx = box.rect.left + 306 * zoom;
    const sy = box.rect.top + 198 * zoom;
    assert.deepEqual(clientPointToPagePoint(sx, sy, [box]), { page: 1, x: 306, y: 198 }, `zoom ${zoom}`);
  }
  // Receiver: page units back to percent of the page box (CSS left/top), so a
  // phone at 75% and a desktop at 200% both put it at the same spot.
  const pct = pagePointToPercent(306, 198, LETTER);
  assert.deepEqual(pct, { left: 50, top: 25 });
  for (const zoom of [0.75, 2]) {
    const box = pageAt(zoom, 0, 0);
    const shownX = box.rect.left + (pct.left / 100) * box.rect.width;
    const shownY = box.rect.top + (pct.top / 100) * box.rect.height;
    assert.ok(Math.abs(shownX - 306 * zoom) < 1e-9 && Math.abs(shownY - 198 * zoom) < 1e-9);
  }
  // Which page: the one under the point; off every page = null.
  const two = [pageAt(1, 100, 0, 1), pageAt(1, 100, 800, 2)];
  assert.deepEqual(clientPointToPagePoint(100 + 10, 800 + 20, two), { page: 2, x: 10, y: 20 });
  assert.equal(clientPointToPagePoint(100 + 10, 795, two), null, 'the gap between pages');
  assert.equal(clientPointToPagePoint(50, 50, two), null, 'beside the page');
  assert.equal(clientPointToPagePoint(NaN, 5, two), null);
  assert.equal(clientPointToPagePoint(5, 5, [{ page: 1, rect: { left: 0, top: 0, width: 0, height: 10 }, size: LETTER }]), null);
  // Rounded to 0.1 pt (well under a pixel at any zoom): small messages.
  assert.deepEqual(clientPointToPagePoint(100 + 10.04, 0.06, [pageAt(1, 100, 0)]), { page: 1, x: 10, y: 0.1 });
  // Percent is clamped to the page; bad sizes give null.
  assert.deepEqual(pagePointToPercent(-5, 900, LETTER), { left: 0, top: 100 });
  assert.equal(pagePointToPercent(1, 1, { width: 0, height: 10 }), null);
});

test('labels: first name, else the email name, kept short', () => {
  assert.equal(cursorLabel('Bo Reed'), 'Bo');
  assert.equal(cursorLabel('isaiah.calvo@example.com'), 'isaiah.calvo');
  assert.equal(cursorLabel(''), 'Someone');
  assert.equal(cursorLabel('Maximiliandrovich Long'), 'Maximiliandrovi…');
});

test('the sender: at once, then at most one message per interval; the last position lands; still = silent', () => {
  __liveCursorsTest.reset();
  const sent = [];
  setLiveCursorSink({ documentId: 'd', writerId: 'w1', send: (payload) => { sent.push(payload); return true; } });
  const clock = fakeClock();
  let at = { page: 1, x: 10, y: 20 };
  const sender = createLiveCursorSender({
    documentId: 'd', resolve: () => at, identity: () => ({ userId: 'user-a', name: 'Ann Lee' }), ...clock,
  });
  sender.poke();
  clock.advance(0);
  assert.equal(sent.length, 1, 'the first point goes at once');
  assert.deepEqual(sent[0], { v: LIVE_CURSOR_VERSION, w: 'w1', p: 1, x: 10, y: 20, u: 'user-a', n: 'Ann Lee' });
  assert.ok(JSON.stringify(sent[0]).length < 120, 'a small message');

  // A 120 Hz mouse for one second: ~120 pointer events -> at most 11 messages.
  for (let frame = 1; frame <= 120; frame += 1) {
    at = { page: 1, x: 10 + frame, y: 20 + frame / 2 };
    sender.poke();
    clock.advance(1000 / 120);
  }
  clock.advance(LIVE_CURSOR_INTERVAL_MS);
  const perSecond = sent.length - 1;
  assert.equal(LIVE_CURSOR_INTERVAL_MS, 100, '10 a second (owner: keep Realtime traffic small)');
  assert.ok(perSecond <= Math.ceil(1000 / LIVE_CURSOR_INTERVAL_MS) + 1, `throttled (${perSecond} messages for 120 events)`);
  assert.ok(perSecond >= 8, `but still lively (${perSecond})`);
  assert.deepEqual([sent.at(-1).x, sent.at(-1).y], [130, 80], 'the last position always lands (trailing edge)');
  for (let index = 2; index < sent.length; index += 1) assert.ok(sent[index].x > sent[index - 1].x, 'in order');

  // Still pointer, or a move under half a point: nothing.
  const before = sent.length;
  sender.poke();
  clock.advance(LIVE_CURSOR_INTERVAL_MS * 3);
  at = { page: 1, x: 130.3, y: 80.2 };
  sender.poke();
  clock.advance(LIVE_CURSOR_INTERVAL_MS * 3);
  assert.equal(sent.length, before, 'a still pointer sends nothing');
  // Same spot on another page is a move.
  at = { page: 2, x: 130.3, y: 80.2 };
  sender.poke();
  clock.advance(LIVE_CURSOR_INTERVAL_MS);
  assert.equal(sent.at(-1).p, 2);

  // Off the pages: one "gone", then silence.
  at = null;
  sender.poke();
  clock.advance(LIVE_CURSOR_INTERVAL_MS);
  assert.deepEqual(sent.at(-1), { v: LIVE_CURSOR_VERSION, w: 'w1', g: 1 });
  const afterGone = sent.length;
  sender.poke();
  clock.advance(LIVE_CURSOR_INTERVAL_MS * 3);
  sender.dispose();
  assert.equal(sent.length, afterGone, 'one "gone" only, none on dispose when nothing shows');
  __liveCursorsTest.reset();
});

test('presence gate: who counts as someone else', () => {
  assert.equal(hasOtherPeoplePresent(null, 'me'), false);
  assert.equal(hasOtherPeoplePresent([], 'me'), false);
  assert.equal(hasOtherPeoplePresent([{ user_id: 'me' }], 'me'), false, 'only me');
  assert.equal(hasOtherPeoplePresent([{ user_id: 'me', client_type: 'app' }, { user_id: 'me', client_type: 'mobile' }], 'me'), false, 'my phone is not someone else');
  assert.equal(hasOtherPeoplePresent([{ user_id: 'me' }, { user_id: 'bo' }], 'me'), true);
  assert.equal(hasOtherPeoplePresent([{ user_id: '' }, null, { display_name: 'x' }], 'me'), false, 'junk rows');
});

test('presence gate: alone = 0 messages during a sweep; someone joins -> it starts; they leave -> it stops', () => {
  __liveCursorsTest.reset();
  const sent = [];
  setLiveCursorSink({ documentId: 'd', writerId: 'w1', send: (payload) => { sent.push(payload); return true; } });
  const clock = fakeClock();
  let presence = [{ user_id: 'me' }];
  let at = { page: 1, x: 10, y: 20 };
  let measured = 0;
  const sender = createLiveCursorSender({
    documentId: 'd',
    resolve: () => { measured += 1; return at; },
    isWanted: () => hasOtherPeoplePresent(presence, 'me'),
    identity: () => ({ userId: 'me', name: 'Me' }),
    ...clock,
  });
  const sweep = (ms) => {
    for (let t = 0; t < ms; t += 1000 / 120) {
      at = { page: 1, x: at.x + 1, y: at.y };
      sender.poke();
      clock.advance(1000 / 120);
    }
    clock.advance(LIVE_CURSOR_INTERVAL_MS);
  };

  // Alone: a 2 s sweep sends nothing, measures nothing, leaves no timer.
  sweep(2000);
  assert.equal(sent.length, 0, 'alone: no message');
  assert.equal(measured, 0, 'alone: the page is not even measured');
  assert.equal(clock.pending(), 0, 'alone: no timer');

  // Bo opens the document: the hook pokes once -> the current point goes out
  // at once (leading edge), with who-this-is.
  presence = [{ user_id: 'me' }, { user_id: 'bo' }];
  sender.poke();
  clock.advance(0);
  assert.equal(sent.length, 1, 'someone joined: the point goes at once');
  assert.equal(sent[0].u, 'me');
  sweep(1000);
  const together = sent.length - 1;
  assert.ok(together >= 8 && together <= 11, `together: ~10 a second (${together})`);

  // Bo leaves: nothing more, not even "gone" (nobody to hear it).
  presence = [{ user_id: 'me' }];
  const atLeave = sent.length;
  sweep(2000);
  at = null;
  sender.poke();
  clock.advance(LIVE_CURSOR_INTERVAL_MS);
  sender.dispose();
  assert.equal(sent.length, atLeave, 'alone again: no message');
  assert.equal(clock.pending(), 0);

  // Someone comes back: the first message carries who-this-is again.
  const again = createLiveCursorSender({
    documentId: 'd', resolve: () => ({ page: 1, x: 1, y: 1 }), isWanted: () => true,
    identity: () => ({ userId: 'me', name: 'Me' }), ...clock,
  });
  again.poke();
  clock.advance(0);
  assert.equal(sent.at(-1).u, 'me');
  again.dispose();
  __liveCursorsTest.reset();
});

test('presence gate: leave and rejoin under a still pointer sends the point again (Codex #831)', () => {
  __liveCursorsTest.reset();
  const sent = [];
  setLiveCursorSink({ documentId: 'd', writerId: 'w1', send: (payload) => { sent.push(payload); return true; } });
  const clock = fakeClock();
  let presence = [{ user_id: 'me' }, { user_id: 'bo' }];
  const sender = createLiveCursorSender({
    documentId: 'd',
    resolve: () => ({ page: 1, x: 10, y: 20 }),
    isWanted: () => hasOtherPeoplePresent(presence, 'me'),
    ...clock,
  });
  sender.poke();
  clock.advance(0);
  assert.equal(sent.length, 1);
  // Bo leaves: the hook pokes on that change too.
  presence = [{ user_id: 'me' }];
  sender.poke();
  clock.advance(LIVE_CURSOR_INTERVAL_MS);
  // Cy joins; the pointer has not moved.
  presence = [{ user_id: 'me' }, { user_id: 'cy' }];
  sender.poke();
  clock.advance(LIVE_CURSOR_INTERVAL_MS);
  assert.equal(sent.length, 2, 'the new person gets the still point');
  assert.equal(sent[1].p, 1);
  sender.dispose();
  __liveCursorsTest.reset();
});

test('the hook pokes the sender on both presence changes, join and leave', () => {
  const src = readFileSync(new URL('../src/hooks/useLiveCursorBroadcast.js', import.meta.url), 'utf8');
  assert.match(src, /useEffect\(\(\) => \{\s*senderRef\.current\?\.poke\(\);\s*\}, \[othersPresent\]\);/);
});

test('the sender: who-this-is rides on the first message and every few seconds, not on each', () => {
  __liveCursorsTest.reset();
  const sent = [];
  setLiveCursorSink({ documentId: 'd', writerId: 'w1', send: (payload) => { sent.push(payload); return true; } });
  const clock = fakeClock();
  let at = { page: 1, x: 10, y: 20 };
  const sender = createLiveCursorSender({
    documentId: 'd', resolve: () => at, identity: () => ({ userId: 'user-a', name: 'Ann Lee' }), ...clock,
  });
  const step = () => { at = { page: 1, x: at.x + 5, y: at.y }; sender.poke(); clock.advance(LIVE_CURSOR_INTERVAL_MS); };
  step();
  assert.equal(sent[0].u, 'user-a');
  assert.equal(sent[0].n, 'Ann Lee');
  while (clock.now() < 1_000 + LIVE_CURSOR_IDENTITY_MS - LIVE_CURSOR_INTERVAL_MS * 2) step();
  const plain = sent.slice(1);
  assert.ok(plain.length >= 12, `many moves (${plain.length})`);
  assert.ok(plain.every((m) => !('u' in m) && !('n' in m)), 'the moves in between carry only the point');
  assert.ok(Math.max(...plain.map((m) => JSON.stringify(m).length)) <= 75, 'a plain move is small');
  for (let i = 0; i < 4; i += 1) step();
  assert.ok(sent.slice(-4).some((m) => m.u === 'user-a' && m.n === 'Ann Lee'), 'repeated after LIVE_CURSOR_IDENTITY_MS');

  // A receiver that joined late shows the cursor at once and learns the name in time.
  __liveCursorsTest.reset();
  assert.equal(applyRemoteLiveCursor('d', { v: LIVE_CURSOR_VERSION, w: 'w9', p: 1, x: 5, y: 6 }, { nowMs: 10 }), true);
  assert.equal(getLiveCursorsForPage(1, 'd')[0].name, null);
  applyRemoteLiveCursor('d', { v: LIVE_CURSOR_VERSION, w: 'w9', p: 1, x: 7, y: 6, u: 'user-a', n: 'Ann Lee' }, { nowMs: 20 });
  applyRemoteLiveCursor('d', { v: LIVE_CURSOR_VERSION, w: 'w9', p: 1, x: 9, y: 6 }, { nowMs: 30 });
  const [shown] = getLiveCursorsForPage(1, 'd');
  assert.deepEqual([shown.x, shown.userId, shown.name], [9, 'user-a', 'Ann Lee'], 'kept once learned');
  __liveCursorsTest.reset();
});

test('the sender: no live channel = no timers and no messages; dispose says "gone"; a refused send retries', () => {
  __liveCursorsTest.reset();
  const clock = fakeClock();
  let at = { page: 3, x: 1, y: 2 };
  const sender = createLiveCursorSender({ documentId: 'd', resolve: () => at, ...clock });
  sender.poke();
  assert.equal(clock.pending(), 0, 'alone (no channel): not even a timer');
  assert.equal(hasLiveCursorSink('d'), false);

  const sent = [];
  let accept = false;
  const unregister = setLiveCursorSink({ documentId: 'd', writerId: 'w2', send: (payload) => { if (accept) sent.push(payload); return accept; } });
  sender.poke();
  clock.advance(0);
  assert.equal(sent.length, 0, 'the channel is rejoining');
  accept = true;
  sender.poke();
  clock.advance(LIVE_CURSOR_INTERVAL_MS);
  assert.equal(sent.length, 1, 'goes out once the channel takes it');
  // Hidden tab: flushNow sends at once (timers may not run in the background).
  at = null;
  sender.flushNow();
  assert.deepEqual(sent.at(-1), { v: LIVE_CURSOR_VERSION, w: 'w2', g: 1 });
  at = { page: 3, x: 50, y: 60 };
  sender.flushNow();
  sender.dispose();
  assert.deepEqual(sent.at(-1), { v: LIVE_CURSOR_VERSION, w: 'w2', g: 1 }, 'closing the document takes the cursor away');
  const count = sent.length;
  sender.poke();
  sender.flushNow();
  clock.advance(1000);
  assert.equal(sent.length, count, 'nothing after dispose');
  unregister();
  assert.equal(hasLiveCursorSink('d'), false);
  __liveCursorsTest.reset();
});

test('the receiver: shows and moves a cursor, ignores itself and junk, caps, fades on "gone" and when idle', () => {
  __liveCursorsTest.reset();
  const msg = (extra) => ({ v: LIVE_CURSOR_VERSION, w: 'bob-1', u: 'user-b', n: 'Bo Reed', p: 1, x: 100, y: 200, ...extra });
  let now = 10_000;
  assert.equal(applyRemoteLiveCursor('d', msg(), { ownWriterId: 'me', nowMs: now }), true);
  let list = getLiveCursorsForPage(1, 'd');
  assert.equal(list.length, 1);
  assert.deepEqual({ ...list[0], key: undefined }, { key: undefined, writerId: 'bob-1', userId: 'user-b', name: 'Bo Reed', x: 100, y: 200, leaving: false });
  assert.equal(getLiveCursorsForPage(1, 'd'), list, 'stable snapshot until something changes');
  assert.equal(getLiveCursorsForPage(1, 'other-doc').length, 0, 'never on another document');

  // Moves, and to another page.
  now += 80;
  applyRemoteLiveCursor('d', msg({ x: 120, y: 210, n: undefined, u: undefined }), { nowMs: now });
  list = getLiveCursorsForPage(1, 'd');
  assert.deepEqual([list[0].x, list[0].y, list[0].name, list[0].userId], [120, 210, 'Bo Reed', 'user-b'], 'keeps the name and person');
  now += 80;
  applyRemoteLiveCursor('d', msg({ p: 2 }), { nowMs: now });
  assert.equal(getLiveCursorsForPage(1, 'd').length, 0);
  assert.equal(getLiveCursorsForPage(2, 'd').length, 1);

  // Itself and junk.
  assert.equal(applyRemoteLiveCursor('d', msg({ w: 'me' }), { ownWriterId: 'me', nowMs: now }), false);
  for (const bad of [
    null, 'x', { v: 3 }, msg({ w: '' }), msg({ w: 'x'.repeat(300) }), msg({ p: 0 }), msg({ p: 1.5 }),
    msg({ x: 'NaN' }), msg({ y: Infinity }), msg({ x: 2e6 }), msg({ p: 200_000 }),
  ]) {
    assert.equal(applyRemoteLiveCursor('d', bad, { nowMs: now }), false, JSON.stringify(bad));
  }
  assert.equal(applyRemoteLiveCursor('', msg(), { nowMs: now }), false);

  // "gone": fades (still listed, leaving), then leaves.
  now += 50;
  assert.equal(applyRemoteLiveCursor('d', { v: LIVE_CURSOR_VERSION, w: 'bob-1', g: 1 }, { nowMs: now }), true);
  assert.equal(getLiveCursorsForPage(2, 'd')[0].leaving, true);
  sweepLiveCursors(now + LIVE_CURSOR_FADE_MS);
  assert.equal(getLiveCursorsForPage(2, 'd').length, 0);

  // Idle: still for LIVE_CURSOR_IDLE_MS -> fades -> gone; a new move before
  // the end brings it straight back.
  now += 1000;
  applyRemoteLiveCursor('d', msg(), { nowMs: now });
  sweepLiveCursors(now + LIVE_CURSOR_IDLE_MS - 1);
  assert.equal(getLiveCursorsForPage(1, 'd')[0].leaving, false, 'not yet');
  sweepLiveCursors(now + LIVE_CURSOR_IDLE_MS);
  assert.equal(getLiveCursorsForPage(1, 'd')[0].leaving, true, 'idle: fading');
  applyRemoteLiveCursor('d', msg({ x: 140 }), { nowMs: now + LIVE_CURSOR_IDLE_MS + 100 });
  assert.equal(getLiveCursorsForPage(1, 'd')[0].leaving, false, 'moved again: back');
  sweepLiveCursors(now + 2 * LIVE_CURSOR_IDLE_MS + 100);
  sweepLiveCursors(now + 2 * LIVE_CURSOR_IDLE_MS + 100 + LIVE_CURSOR_FADE_MS);
  assert.equal(getLiveCursorsForPage(1, 'd').length, 0, 'idle then gone');

  // Cap on cursors, and a per-writer flood guard.
  now += 100_000;
  for (let i = 0; i < LIVE_CURSOR_MAX + 5; i += 1) applyRemoteLiveCursor('d', msg({ w: `w${i}` }), { nowMs: now });
  assert.equal(getLiveCursorsForPage(1, 'd').length, LIVE_CURSOR_MAX);
  clearLiveCursors('d');
  assert.equal(getLiveCursorsForPage(1, 'd').length, 0, 'document closed: all go');
  now = 500_000;
  let accepted = 0;
  for (let i = 0; i < LIVE_CURSOR_RECEIVE_PER_SEC + 20; i += 1) {
    if (applyRemoteLiveCursor('d', msg({ w: 'flood', x: i }), { nowMs: now })) accepted += 1;
  }
  assert.equal(accepted, LIVE_CURSOR_RECEIVE_PER_SEC, 'a flood from one writer is dropped');
  __liveCursorsTest.reset();
});

test('end to end: a cursor reaches the other screen over the live channel and leaves on "gone"; nothing is written', async () => {
  __liveCursorsTest.reset();
  const documentId = 'live-cursor-e2e';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId);
  const b = await openFor(bob, documentId);
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  await settle(20);
  assert.ok(await until(() => hasLiveCursorSink(documentId)), 'the open document registers its cursor sink');
  // One process holds both handles, so the sink is the last one's (Bob's);
  // the cursor he sends arrives at Alice's handle through the live channel.
  let at = { page: 1, x: 306, y: 198 };
  const sender = createLiveCursorSender({ documentId, resolve: () => at, identity: () => ({ userId: 'user-b', name: 'Bo Reed' }) });
  sender.poke();
  assert.ok(await until(() => getLiveCursorsForPage(1, documentId).length === 1), 'the cursor shows on the other screen');
  const shown = getLiveCursorsForPage(1, documentId)[0];
  assert.deepEqual([shown.x, shown.y, shown.userId, shown.name], [306, 198, 'user-b', 'Bo Reed']);
  at = null;
  sender.poke();
  assert.ok(await until(() => getLiveCursorsForPage(1, documentId)[0]?.leaving === true), '"gone" fades it');
  assert.equal(alice.appendCalls + bob.appendCalls, 0, 'a cursor is never written');
  sender.dispose();
  await Promise.all([a.destroy(), b.destroy()]);
  assert.equal(hasLiveCursorSink(documentId), false, 'closing the document removes the sink');
  __liveCursorsTest.reset();
});


test('live cursor points use the reflected page frame before remote overlay placement',()=>{
  const pages=[{page:1,rect:{left:10,top:20,width:200,height:100,mirrorH:true,mirrorV:true},size:{width:400,height:200}}];
  assert.deepEqual(clientPointToPagePoint(50,50,pages),{page:1,x:320,y:140});
  assert.equal(clientPointToPagePoint(500,50,pages),null);
});
